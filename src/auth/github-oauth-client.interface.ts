export interface GithubOauthProfile {
  githubId: string;
  githubLogin: string;
  avatarUrl: string | null;
}

/**
 * Abstraction over GitHub's OAuth web flow - same swappable-provider shape
 * as GithubClient (github-client.interface.ts). The real implementation is
 * two plain `fetch()` calls (Node 22 has global fetch); tests substitute a
 * fake via `overrideProvider(GITHUB_OAUTH_CLIENT)` instead of hitting
 * github.com.
 */
export interface GithubOauthClient {
  getAuthorizeUrl(state: string): string;
  exchangeCodeForProfile(code: string): Promise<GithubOauthProfile>;
}
