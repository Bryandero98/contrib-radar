import { Injectable } from '@nestjs/common';
import type {
  GithubOauthClient,
  GithubOauthProfile,
} from './github-oauth-client.interface';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required (see .env.example).`);
  }
  return value;
}

interface GithubAccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
  avatar_url: string | null;
}

// Hand-rolled, not passport-github2: the exchange is two plain fetch()
// calls (Node 22 ships a global fetch), and Passport's strategy model is
// built around session-store-backed sessions - it doesn't fit this app's
// stateless-JWT-in-a-cookie design, which has no Redis/session store on
// Render's free tier.
@Injectable()
export class GithubOauthProvider implements GithubOauthClient {
  getAuthorizeUrl(state: string): string {
    const clientId = requireEnv('GITHUB_OAUTH_CLIENT_ID');
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${appUrl}/auth/github/callback`,
      scope: 'read:user',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCodeForProfile(code: string): Promise<GithubOauthProfile> {
    const clientId = requireEnv('GITHUB_OAUTH_CLIENT_ID');
    const clientSecret = requireEnv('GITHUB_OAUTH_CLIENT_SECRET');

    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      },
    );
    const tokenBody = (await tokenRes.json()) as GithubAccessTokenResponse;
    if (!tokenBody.access_token) {
      throw new Error(
        `GitHub OAuth token exchange failed: ${
          tokenBody.error_description ?? tokenBody.error ?? 'unknown error'
        }`,
      );
    }

    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${tokenBody.access_token}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!userRes.ok) {
      throw new Error(`GitHub /user request failed (${userRes.status}).`);
    }
    const profile = (await userRes.json()) as GithubUserResponse;

    return {
      githubId: String(profile.id),
      githubLogin: profile.login,
      avatarUrl: profile.avatar_url,
    };
  }
}
