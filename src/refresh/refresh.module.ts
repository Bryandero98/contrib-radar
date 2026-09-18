import { Module } from '@nestjs/common';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';
import { ScoringModule } from '../scoring/scoring.module';
import { RefreshController } from './refresh.controller';
import { RefreshService } from './refresh.service';

@Module({
  imports: [ScoringModule, AuthModule, AlertsModule],
  controllers: [RefreshController],
  providers: [RefreshService],
  exports: [RefreshService],
})
export class RefreshModule {}
