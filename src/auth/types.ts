export interface AuthenticatedUser {
  id: string;
  githubLogin: string;
  tier: 'free' | 'pro';
}

// Augments Express's Request so req.user (set by JwtCookieAuthGuard /
// ApiKeyAuthGuard) is typed everywhere without an `as` cast at every call
// site - `declare global { namespace Express {...} }` is how @types/express
// itself declares Request, so augmenting it needs the same shape.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
