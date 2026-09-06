import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { GithubModule } from './github/github.module';
import { HealthModule } from './health/health.module';
import { IssuesModule } from './issues/issues.module';
import { RequestLoggerMiddleware } from './logging/request-logger.middleware';
import { McpModule } from './mcp/mcp.module';
import { RefreshModule } from './refresh/refresh.module';
import { SentimentModule } from './sentiment/sentiment.module';
import { WatchedReposModule } from './watched-repos/watched-repos.module';

@Module({
  imports: [
    // Generous global default (100 req/min per IP) - cheap insurance now
    // that this is unauthenticated. Mutating endpoints layer a stricter
    // @Throttle() on top (see common/write-throttle.ts).
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule,
    GithubModule,
    SentimentModule,
    WatchedReposModule,
    RefreshModule,
    IssuesModule,
    DashboardModule,
    McpModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
