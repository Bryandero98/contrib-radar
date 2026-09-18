import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClaimAssistantController } from './claim-assistant.controller';
import { ClaimAssistantService } from './claim-assistant.service';
import { CLAIM_DECISION_PROVIDER } from './claim-decision-provider.token';
import { GeminiClaimDecisionProvider } from './providers/gemini-claim-decision.provider';

// GITHUB_CLIENT and DRIZZLE are @Global() (GithubModule/DatabaseModule) -
// not imported here for the same reason UsersModule never imports them
// either.
@Module({
  imports: [AuthModule],
  controllers: [ClaimAssistantController],
  providers: [
    ClaimAssistantService,
    { provide: CLAIM_DECISION_PROVIDER, useClass: GeminiClaimDecisionProvider },
  ],
  exports: [ClaimAssistantService],
})
export class ClaimAssistantModule {}
