import { Injectable, Logger } from '@nestjs/common';
import { RateLimiter } from '../../common/rate-limiter';
import type {
  FetchIssuesForScoringParams,
  GithubClient,
  GithubIssue,
  GithubIssueComment,
  GithubPullRequestRef,
} from '../github-client.interface';

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

// GitHub's GraphQL secondary rate limit guidance: no more than ~1 request/sec
// sustained. 800ms keeps meaningful headroom without needlessly slowing down
// a single-repo refresh (a handful of pages at most).
const REQUEST_INTERVAL_MS = 800;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
const ISSUES_PAGE_SIZE = 25;
const COMMENTS_PAGE_SIZE = 20;
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const ISSUE_FIELDS = `
  number
  title
  url
  state
  createdAt
  updatedAt
  labels(first: 10) { nodes { name } }
  assignees(first: 5) { nodes { login } }
  comments(last: ${COMMENTS_PAGE_SIZE}) {
    pageInfo { hasPreviousPage startCursor }
    nodes { author { login } authorAssociation body createdAt }
  }
  timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 25) {
    nodes {
      ... on CrossReferencedEvent {
        isCrossRepository
        source { ... on PullRequest { number url state isDraft merged } }
      }
    }
  }
`;

const REPO_ISSUES_QUERY = `
  query RepoIssuesForScoring($owner: String!, $name: String!, $labels: [String!], $after: String) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $name) {
      issues(
        first: ${ISSUES_PAGE_SIZE}
        after: $after
        states: OPEN
        labels: $labels
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        pageInfo { hasNextPage endCursor }
        nodes { ${ISSUE_FIELDS} }
      }
    }
  }
`;

const SINGLE_ISSUE_QUERY = `
  query SingleIssueForScoring($owner: String!, $name: String!, $number: Int!) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $name) {
      issue(number: $number) { ${ISSUE_FIELDS} }
    }
  }
`;

const OLDER_COMMENTS_QUERY = `
  query OlderIssueComments($owner: String!, $name: String!, $number: Int!, $before: String!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        comments(last: ${COMMENTS_PAGE_SIZE}, before: $before) {
          nodes { author { login } authorAssociation body createdAt }
        }
      }
    }
  }
`;

interface RawCrossReferencedEvent {
  isCrossRepository: boolean;
  source?: {
    number: number;
    url: string;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    isDraft: boolean;
    merged: boolean;
  };
}

interface RawComment {
  author: { login: string } | null;
  authorAssociation: string;
  body: string;
  createdAt: string;
}

interface RawIssueNode {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string }[] };
  comments: {
    pageInfo: { hasPreviousPage: boolean; startCursor: string | null };
    nodes: RawComment[];
  };
  timelineItems: { nodes: RawCrossReferencedEvent[] };
}

interface RateLimitInfo {
  cost: number;
  remaining: number;
  resetAt: string;
}

interface RepoIssuesQueryResult {
  rateLimit: RateLimitInfo;
  repository: {
    issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawIssueNode[];
    };
  } | null;
}

interface SingleIssueQueryResult {
  rateLimit: RateLimitInfo;
  repository: { issue: RawIssueNode | null } | null;
}

interface OlderCommentsQueryResult {
  repository: { issue: { comments: { nodes: RawComment[] } } | null } | null;
}

// Reference GithubClient implementation - GraphQL instead of the REST
// Search API used manually all through the session this project grew out
// of. A single query per page carries everything scoring needs (assignees,
// comments, cross-referencing PRs) inline, instead of the REST
// `search/issues?q=is:pr+N+in:body` round-trip per issue that kept hitting
// secondary rate limits.
@Injectable()
export class GithubGraphqlProvider implements GithubClient {
  private readonly logger = new Logger(GithubGraphqlProvider.name);
  private readonly rateLimiter = new RateLimiter(REQUEST_INTERVAL_MS);

  async fetchIssuesForScoring(
    params: FetchIssuesForScoringParams,
  ): Promise<GithubIssue[]> {
    const issues: GithubIssue[] = [];
    let after: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: RepoIssuesQueryResult =
        await this.request<RepoIssuesQueryResult>(REPO_ISSUES_QUERY, {
          owner: params.owner,
          name: params.name,
          labels: params.labels,
          after,
        });

      this.logRateLimit(data.rateLimit);

      if (!data.repository) {
        throw new Error(
          `repository "${params.owner}/${params.name}" not found (or the token can't see it)`,
        );
      }

      for (const node of data.repository.issues.nodes) {
        issues.push(await this.toGithubIssue(params.owner, params.name, node));
      }

      hasNextPage = data.repository.issues.pageInfo.hasNextPage;
      after = data.repository.issues.pageInfo.endCursor;
    }

    return issues;
  }

  async fetchSingleIssueForScoring(
    owner: string,
    name: string,
    issueNumber: number,
  ): Promise<GithubIssue | null> {
    const data: SingleIssueQueryResult =
      await this.request<SingleIssueQueryResult>(SINGLE_ISSUE_QUERY, {
        owner,
        name,
        number: issueNumber,
      });

    this.logRateLimit(data.rateLimit);

    const node = data.repository?.issue;
    if (!node) {
      return null;
    }
    return this.toGithubIssue(owner, name, node);
  }

  private async toGithubIssue(
    owner: string,
    name: string,
    node: RawIssueNode,
  ): Promise<GithubIssue> {
    let comments = node.comments.nodes;
    let maintainerCommentsFullyChecked = true;

    // Safeguard: comments(last: 20) can bury the one maintainer comment
    // that actually matters under a long thread of other contributors -
    // exactly what happened repeatedly in this session's manual research.
    // If none of the last 20 are from a maintainer and an older page
    // exists, fetch one more page before giving up (hard cap: 2 pages
    // total, never paginate indefinitely).
    const hasMaintainerComment = comments.some((c) =>
      MAINTAINER_ASSOCIATIONS.has(c.authorAssociation),
    );
    if (
      !hasMaintainerComment &&
      node.comments.pageInfo.hasPreviousPage &&
      node.comments.pageInfo.startCursor
    ) {
      try {
        const older = await this.fetchOlderComments(
          owner,
          name,
          node.number,
          node.comments.pageInfo.startCursor,
        );
        comments = [...older, ...comments];
      } catch (error) {
        this.logger.warn(
          `fallback comment page fetch failed for ${owner}/${name}#${node.number}: ${String(error)}`,
        );
        maintainerCommentsFullyChecked = false;
      }
    }

    const mappedComments: GithubIssueComment[] = comments.map((c) => ({
      authorLogin: c.author?.login ?? null,
      authorAssociation: c.authorAssociation,
      body: c.body,
      createdAt: c.createdAt,
    }));

    const crossReferencingPullRequests: GithubPullRequestRef[] =
      node.timelineItems.nodes
        .filter((e) => !e.isCrossRepository && e.source)
        .map((e) => ({
          number: e.source!.number,
          url: e.source!.url,
          state: e.source!.state,
          isDraft: e.source!.isDraft,
          merged: e.source!.merged,
        }));

    return {
      number: node.number,
      title: node.title,
      url: node.url,
      state: node.state,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      labels: node.labels.nodes.map((l) => l.name),
      assigneeLogins: node.assignees.nodes.map((a) => a.login),
      comments: mappedComments,
      crossReferencingPullRequests,
      maintainerCommentsFullyChecked,
    };
  }

  private async fetchOlderComments(
    owner: string,
    name: string,
    issueNumber: number,
    before: string,
  ): Promise<RawComment[]> {
    const data: OlderCommentsQueryResult =
      await this.request<OlderCommentsQueryResult>(OLDER_COMMENTS_QUERY, {
        owner,
        name,
        number: issueNumber,
        before,
      });
    return data.repository?.issue?.comments.nodes ?? [];
  }

  private logRateLimit(rateLimit: RateLimitInfo): void {
    this.logger.debug(
      `GraphQL cost=${rateLimit.cost} remaining=${rateLimit.remaining} resetAt=${rateLimit.resetAt}`,
    );
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    return this.rateLimiter.schedule<T>(() =>
      this.requestWithRetry<T>(query, variables, 0),
    );
  }

  private async requestWithRetry<T>(
    query: string,
    variables: Record<string, unknown>,
    attempt: number,
  ): Promise<T> {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error(
        'GITHUB_TOKEN is required (GraphQL has no anonymous tier) - see .env.example.',
      );
    }

    const response = await fetch(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (
      (response.status === 429 || response.status === 403) &&
      attempt < MAX_RETRIES
    ) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.requestWithRetry<T>(query, variables, attempt + 1);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub GraphQL request failed (${response.status}): ${body}`,
      );
    }

    const payload = (await response.json()) as {
      data?: T;
      errors?: { message: string }[];
    };
    if (payload.errors?.length) {
      throw new Error(
        `GitHub GraphQL returned errors: ${payload.errors.map((e) => e.message).join('; ')}`,
      );
    }
    if (!payload.data) {
      throw new Error('GitHub GraphQL response had no data and no errors');
    }
    return payload.data;
  }
}
