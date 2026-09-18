import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { UsersService } from '../users/users.service';
import { renderDashboardHtml } from './dashboard.html';

interface SessionPayload {
  sub: string;
}

// Excluded from Swagger (it's a page, not an API operation) and exempt
// from the global rate limit (a browser may reload it freely) - same
// reasoning as packetforge's DashboardController.
@SkipThrottle()
@ApiExcludeController()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async serve(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = req.cookies?.session as string | undefined;
    const user = token ? await this.loadUser(token) : null;

    // A redirect, not a 401 - this is a browser navigating to a page, not
    // an API caller. JwtCookieAuthGuard's 401 is for the REST API this
    // page itself calls (GET /repos, etc.), not for this route.
    if (!user) {
      res.redirect('/auth/github');
      return;
    }

    res.type('html').send(
      renderDashboardHtml({
        githubLogin: user.githubLogin,
        tier: user.tier,
        alertWebhookUrl: user.alertWebhookUrl,
      }),
    );
  }

  private async loadUser(token: string) {
    try {
      const payload = this.jwtService.verify<SessionPayload>(token);
      return this.usersService.findById(payload.sub);
    } catch {
      return null;
    }
  }
}
