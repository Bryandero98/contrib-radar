// Its own file, not declared inline in claim-assistant.module.ts - same
// circular-import bug already documented on stripe-client.token.ts (that
// file also imports the service that needs this token, so the token's
// `export const` line never ran before @Inject tried to resolve it).
export const CLAIM_DECISION_PROVIDER = Symbol('CLAIM_DECISION_PROVIDER');
