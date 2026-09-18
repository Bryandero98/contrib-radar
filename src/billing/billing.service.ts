import { BadRequestException, Inject, Injectable } from '@nestjs/common';
// Not a type-only import: emitDecoratorMetadata needs a real runtime
// binding for `Stripe` to populate this constructor's design:paramtypes,
// even though @Inject(STRIPE_CLIENT) is what Nest actually uses to
// resolve the value - `import type` here silently produced `undefined`
// design:paramtypes[0], which broke DI with no compile-time warning.
import Stripe from 'stripe';
import { UsersService } from '../users/users.service';
import { STRIPE_CLIENT } from './stripe-client.token';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see .env.example).`);
  }
  return value;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly usersService: UsersService,
  ) {}

  async createCheckoutSession(userId: string): Promise<string> {
    const priceId = requireEnv('STRIPE_PRO_PRICE_ID');
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      client_reference_id: userId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?upgraded=1`,
      cancel_url: `${appUrl}/dashboard`,
    });

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.');
    }
    return session.url;
  }

  // The Stripe-hosted Customer Portal (subscription cancel/reactivate,
  // payment method, invoice history) - avoids building any of that
  // ourselves for v1, same "let Stripe own it" call as Checkout itself.
  async createPortalSession(userId: string): Promise<string> {
    const user = await this.usersService.findById(userId);
    if (!user?.stripeCustomerId) {
      throw new BadRequestException(
        'No Stripe customer on file yet - upgrade to Pro first.',
      );
    }
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appUrl}/dashboard`,
    });
    return session.url;
  }

  // The endpoint has no session/API-key guard (Stripe can't send either) -
  // this signature check against STRIPE_WEBHOOK_SECRET is what establishes
  // the request genuinely came from Stripe, so it needs the untouched raw
  // body, not the parsed one (see billing.controller.ts + main.ts's
  // rawBody:true).
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }

  // Both branches are idempotent UPDATEs - no dedup table needed even if
  // Stripe redelivers the same event.
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (!userId) return;
        await this.usersService.setTier(userId, 'pro', {
          stripeCustomerId:
            typeof session.customer === 'string' ? session.customer : undefined,
          stripeSubscriptionId:
            typeof session.subscription === 'string'
              ? session.subscription
              : undefined,
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : null;
        if (!customerId) return;
        const user = await this.usersService.findByStripeCustomerId(customerId);
        if (!user) return;
        await this.usersService.setTier(user.id, 'free');
        break;
      }
      default:
        break;
    }
  }
}
