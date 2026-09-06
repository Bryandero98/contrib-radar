import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { IssuesService } from '../issues/issues.service';
import { RefreshService } from '../refresh/refresh.service';
import { WatchedReposService } from '../watched-repos/watched-repos.service';

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

// Same isError:true pattern as packetforge's McpServerFactory - a
// NotFoundException or a GitHub/Gemini failure thrown by a service is a
// real, expected failure the calling agent should see as text it can act
// on, not a dropped connection.
function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

// One MCP tool per REST capability, plus the one tool that has no REST
// equivalent: check_issue_feasibility, which is the whole reason this
// project exists - a single live call replacing the hour of manual
// cross-checking (assignee, competing PRs, maintainer comments) this
// session did by hand across 5 organizations before contrib-radar existed.
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly watchedReposService: WatchedReposService,
    private readonly refreshService: RefreshService,
    private readonly issuesService: IssuesService,
  ) {}

  create(): McpServer {
    const server = new McpServer({ name: 'contrib-radar', version: '0.0.1' });

    server.registerTool(
      'list_watched_repos',
      { description: 'List every repo contrib-radar is watching.' },
      async () => {
        try {
          return textResult(await this.watchedReposService.listWatchedRepos());
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'add_watched_repo',
      {
        description:
          'Start watching a repo for scored issues - idempotent, returns the existing row if this owner/name is already watched.',
        inputSchema: {
          owner: z.string().describe('GitHub org/user that owns the repo'),
          name: z.string().describe('Repo name (without the owner)'),
          labelFilter: z
            .array(z.string())
            .optional()
            .describe(
              'Issue labels to score - defaults to ["good first issue"] if omitted',
            ),
        },
      },
      async ({ owner, name, labelFilter }) => {
        try {
          return textResult(
            await this.watchedReposService.addWatchedRepo(
              owner,
              name,
              labelFilter,
            ),
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'refresh_repo',
      {
        description:
          'Refresh scored issues for a watched repo - a 5-minute cooldown returns the cached snapshot instead of re-hitting GitHub/Gemini.',
        inputSchema: {
          watchedRepoId: z
            .string()
            .describe("The watched repo's id (see list_watched_repos)"),
        },
      },
      async ({ watchedRepoId }) => {
        try {
          return textResult(
            await this.refreshService.refreshWatchedRepo(watchedRepoId),
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'list_scored_issues',
      {
        description:
          'List the current scored snapshot for a watched repo, highest-opportunity first by default.',
        inputSchema: {
          watchedRepoId: z
            .string()
            .describe("The watched repo's id (see list_watched_repos)"),
          sort: z
            .enum(['score', 'updated'])
            .optional()
            .describe('Sort order - defaults to score descending'),
        },
      },
      async ({ watchedRepoId, sort }) => {
        try {
          return textResult(
            await this.issuesService.listScoredIssues(watchedRepoId, sort),
          );
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      'check_issue_feasibility',
      {
        description:
          'Score one issue live, right now, with no caching and no cooldown - the single call that answers "is this issue actually still available, and does a maintainer actually want it worked on?" for a repo that may not even be watched yet.',
        inputSchema: {
          owner: z.string().describe('GitHub org/user that owns the repo'),
          name: z.string().describe('Repo name (without the owner)'),
          issueNumber: z.number().int().positive().describe('The issue number'),
        },
      },
      async ({ owner, name, issueNumber }) => {
        try {
          const result = await this.refreshService.scoreSingleIssue(
            owner,
            name,
            issueNumber,
          );
          if (!result) {
            return errorResult(
              new Error(`issue ${owner}/${name}#${issueNumber} not found`),
            );
          }
          return textResult(result);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    return server;
  }
}
