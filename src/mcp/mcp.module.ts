import { Module } from '@nestjs/common';
import { IssuesModule } from '../issues/issues.module';
import { RefreshModule } from '../refresh/refresh.module';
import { WatchedReposModule } from '../watched-repos/watched-repos.module';
import { McpController } from './mcp.controller';
import { McpServerFactory } from './mcp-server.factory';

@Module({
  imports: [WatchedReposModule, RefreshModule, IssuesModule],
  controllers: [McpController],
  providers: [McpServerFactory],
})
export class McpModule {}
