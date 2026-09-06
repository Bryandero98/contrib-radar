import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';

@Module({
  imports: [ScoringModule],
  controllers: [RefreshController],
  providers: [RefreshService],
  exports: [RefreshService],
})
export class RefreshModule {}
