import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { UsersService } from '../users/users.service';
import { GITHUB_OAUTH_CLIENT } from './github-oauth-client.token';
import type { GithubOauthClient } from './github-oauth-client.interface';

const OAUTH_STATE_COOKIE = 'oauth_state';
const SESSION_COOKIE = 'session';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  };
}

// Browser-navigation endpoints (redirects, not JSON) - excluded from
// Swagger for the same reason as DashboardController.
@SkipThrottle()
@ApiExcludeController()
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(GITHUB_OAUTH_CLIENT)
    private readonly githubOauthClient: GithubOauthClient,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('github')
  startLogin(@Res() res: Response): void {
    const state = randomBytes(16).toString('hex');
    res.cookie(
      OAUTH_STATE_COOKIE,
      state,
      cookieOptions(OAUTH_STATE_MAX_AGE_MS),
    );
    res.redirect(this.githubOauthClient.getAuthorizeUrl(state));
  }

  @Get('github/callback')
  async handleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as
      string | undefined;
    res.clearCookie(OAUTH_STATE_COOKIE);

    // Missing/mismatched state means either a forged callback or an
    // expired login attempt - either way, no session gets created.
    if (!code || !state || !expectedState || state !== expectedState) {
      res.status(400).send('GitHub login failed: invalid or expired state.');
      return;
    }

    const profile = await this.githubOauthClient.exchangeCodeForProfile(code);
    const user = await this.usersService.findOrCreateByGithub(profile);
    const token = this.jwtService.sign({ sub: user.id });

    res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_MAX_AGE_MS));
    res.redirect('/dashboard');
  }

  @Post('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(SESSION_COOKIE);
    res.redirect('/dashboard');
  }
}
