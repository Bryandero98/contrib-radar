// Its own file, not declared inline in auth.module.ts - same circular-
// require reasoning as billing/stripe-client.token.ts: auth.module.ts also
// imports AuthController, which needs this token, so declaring it inline
// there created a cycle where the token was still undefined at the moment
// AuthController's @Inject(GITHUB_OAUTH_CLIENT) decorator ran.
export const GITHUB_OAUTH_CLIENT = Symbol('GITHUB_OAUTH_CLIENT');
