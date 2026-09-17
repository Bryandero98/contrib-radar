import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { STRIPE_CLIENT } from './stripe-client.token';

// UsersModule isn't imported here - it's @Global() (see users.module.ts),
// same reasoning as GithubModule/SentimentModule never being imported by
// their consumers. STRIPE_CLIENT is its own swappable provider, testable
// via overrideProvider(STRIPE_CLIENT) with a fake, same pattern as the
// rest of this codebase.
@Module({
  imports: [AuthModule],
  controllers: [BillingController],
  providers: [
    {
      provide: STRIPE_CLIENT,
      useFactory: (): Stripe => {
        if (!process.env.STRIPE_SECRET_KEY) {
          throw new Error('STRIPE_SECRET_KEY is required (see .env.example).');
        }
        return new Stripe(process.env.STRIPE_SECRET_KEY);
      },
    },
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
