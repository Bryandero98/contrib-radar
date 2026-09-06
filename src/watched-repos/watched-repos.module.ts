import { Module } from '@nestjs/common';
import { WatchedReposController } from './watched-repos.controller';
import { WatchedReposService } from './watched-repos.service';

@Module({
  controllers: [WatchedReposController],
  providers: [WatchedReposService],
  exports: [WatchedReposService],
})
export class WatchedReposModule {}
