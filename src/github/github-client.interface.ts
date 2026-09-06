export interface GithubPullRequestRef {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  merged: boolean;
}

export interface GithubIssueComment {
  authorLogin: string | null;
  /** OWNER | MEMBER | COLLABORATOR | CONTRIBUTOR | NONE | ... */
  authorAssociation: string;
  body: string;
  createdAt: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  labels: string[];
  assigneeLogins: string[];
  comments: GithubIssueComment[];
  /** Open or merged PRs whose timeline cross-references this issue. */
  crossReferencingPullRequests: GithubPullRequestRef[];
  /** true once a maintainer-authored comment was confirmed present (or confirmed absent after the fallback page) - see fetchIssuesForScoring's doc comment. */
  maintainerCommentsFullyChecked: boolean;
}

export interface FetchIssuesForScoringParams {
  owner: string;
  name: string;
  labels: string[];
}

/**
 * Abstraction over GitHub's API - same swappable-provider shape as
 * EmbeddingProvider in packetforge. The GraphQL provider is the only
 * implementation for now, but scoring/refresh never talk to `fetch`
 * directly, only to this interface.
 */
export interface GithubClient {
  fetchIssuesForScoring(
    params: FetchIssuesForScoringParams,
  ): Promise<GithubIssue[]>;

  fetchSingleIssueForScoring(
    owner: string,
    name: string,
    issueNumber: number,
  ): Promise<GithubIssue | null>;
}
