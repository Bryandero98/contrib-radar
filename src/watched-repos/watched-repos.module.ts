import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WatchedReposController } from './watched-repos.controller';
import { WatchedReposService } from './watched-repos.service';

@Module({
  imports: [AuthModule],
  controllers: [WatchedReposController],
  providers: [WatchedReposService],
  exports: [WatchedReposService],
})
export class WatchedReposModule {}
