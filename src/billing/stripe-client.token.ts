// Its own file, not declared inline in billing.module.ts: that file also
// imports BillingService, and BillingService needs this token - declaring
// it inline created a circular require (module.ts -> service.ts ->
// module.ts) where BillingService's module code ran before the token's
// `export const` line executed, so @Inject(STRIPE_CLIENT) silently
// resolved to undefined. A separate file with no back-reference to either
// avoids the cycle entirely.
export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');
