import { Global, Module } from '@nestjs/common';
import { GithubGraphqlProvider } from './providers/github-graphql.provider';

export const GITHUB_CLIENT = Symbol('GITHUB_CLIENT');

// Global, same as DatabaseModule - every module that needs live GitHub
// data (refresh, MCP's check_issue_feasibility) needs this, and it has no
// per-module configuration to justify importing it explicitly everywhere.
@Global()
@Module({
  providers: [{ provide: GITHUB_CLIENT, useClass: GithubGraphqlProvider }],
  exports: [GITHUB_CLIENT],
})
export class GithubModule {}
