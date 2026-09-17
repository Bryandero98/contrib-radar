import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type Stripe from 'stripe';
import { DRIZZLE } from '../database/database.module';
import * as schema from '../database/schema';
import { UsersService } from '../users/users.service';
import { BillingService } from './billing.service';
import { STRIPE_CLIENT } from './stripe-client.token';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

// A fake implementing only the two Stripe surfaces BillingService touches -
// same overrideProvider-with-a-fake pattern as GITHUB_CLIENT/
// SENTIMENT_PROVIDER elsewhere in this codebase, rather than mocking the
// Stripe SDK's internals.
function fakeStripe(): Stripe {
  return {
    checkout: {
      sessions: { create: jest.fn() },
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  } as unknown as Stripe;
}

function checkoutCompletedEvent(
  overrides: Partial<Stripe.Checkout.Session> = {},
): Stripe.Event {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        client_reference_id: null,
        customer: null,
        subscription: null,
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionDeletedEvent(customer: string | null): Stripe.Event {
  return {
    type: 'customer.subscription.deleted',
    data: { object: { customer } },
  } as unknown as Stripe.Event;
}

describeIfDb('BillingService', () => {
  let pool: Pool;
  let usersService: UsersService;
  let stripe: Stripe;
  let service: BillingService;
  const originalPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(async () => {
    process.env.STRIPE_PRO_PRICE_ID = 'price_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(`DELETE FROM watched_repos`);
    await pool.query(`DELETE FROM users`);

    const db = drizzle(pool, { schema });
    stripe = fakeStripe();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        UsersService,
        { provide: DRIZZLE, useValue: db },
        { provide: STRIPE_CLIENT, useValue: stripe },
      ],
    }).compile();
    service = moduleRef.get(BillingService);
    usersService = moduleRef.get(UsersService);
  });

  afterEach(async () => {
    process.env.STRIPE_PRO_PRICE_ID = originalPriceId;
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
    await pool.end();
  });

  describe('createCheckoutSession', () => {
    it('creates a subscription-mode session tagged with the user id', async () => {
      (stripe.checkout.sessions.create as jest.Mock).mockResolvedValue({
        url: 'https://checkout.stripe.com/session/abc',
      });

      const url = await service.createCheckoutSession('user-1');

      expect(url).toBe('https://checkout.stripe.com/session/abc');
      // Passing Stripe's typed method into expect() as a bare mock
      // reference is the standard jest+typescript-eslint false positive,
      // not a real risk here.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(stripe.checkout.sessions.create as jest.Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          client_reference_id: 'user-1',
          line_items: [{ price: 'price_123', quantity: 1 }],
        }),
      );
    });

    it('throws when Stripe does not return a URL', async () => {
      (stripe.checkout.sessions.create as jest.Mock).mockResolvedValue({
        url: null,
      });

      await expect(service.createCheckoutSession('user-1')).rejects.toThrow(
        /did not return a checkout URL/,
      );
    });
  });

  describe('handleEvent', () => {
    it('upgrades the user to pro on checkout.session.completed', async () => {
      const user = await usersService.findOrCreateByGithub({
        githubId: '1',
        githubLogin: 'octocat',
        avatarUrl: null,
      });
      const event = checkoutCompletedEvent({
        client_reference_id: user.id,
        customer: 'cus_123',
        subscription: 'sub_123',
      });

      await service.handleEvent(event);

      const updated = await usersService.findById(user.id);
      expect(updated).toMatchObject({
        tier: 'pro',
        stripeCustomerId: 'cus_123',
        stripeSubscriptionId: 'sub_123',
      });
    });

    it('ignores checkout.session.completed with no client_reference_id', async () => {
      await expect(
        service.handleEvent(checkoutCompletedEvent()),
      ).resolves.toBeUndefined();
    });

    it('downgrades the user to free on customer.subscription.deleted', async () => {
      const user = await usersService.findOrCreateByGithub({
        githubId: '1',
        githubLogin: 'octocat',
        avatarUrl: null,
      });
      await usersService.setTier(user.id, 'pro', {
        stripeCustomerId: 'cus_123',
      });

      await service.handleEvent(subscriptionDeletedEvent('cus_123'));

      const updated = await usersService.findById(user.id);
      expect(updated?.tier).toBe('free');
    });

    it('ignores customer.subscription.deleted for an unknown customer id', async () => {
      await expect(
        service.handleEvent(subscriptionDeletedEvent('cus_unknown')),
      ).resolves.toBeUndefined();
    });

    it('ignores event types it does not handle', async () => {
      const event = {
        type: 'invoice.paid',
        data: { object: {} },
      } as Stripe.Event;

      await expect(service.handleEvent(event)).resolves.toBeUndefined();
    });
  });
});
