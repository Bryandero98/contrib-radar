import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatchedReposModule } from '../watched-repos/watched-repos.module';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';

@Module({
  imports: [AuthModule, WatchedReposModule],
  controllers: [IssuesController],
  providers: [IssuesService],
  exports: [IssuesService],
})
export class IssuesModule {}
