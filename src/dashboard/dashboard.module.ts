import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardController } from './dashboard.controller';

// UsersModule isn't imported here - it's @Global() (see users.module.ts).
@Module({
  imports: [AuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
