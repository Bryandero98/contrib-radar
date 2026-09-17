import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';

interface SessionPayload {
  sub: string;
}

// Guards the dashboard's REST API (watched-repos, refresh, issues) and
// POST /users/me/api-key - a 401 here is correct for an API call, unlike
// DashboardController's own session check, which redirects instead
// because that route is browser navigation, not a fetch() call.
@Injectable()
export class JwtCookieAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.session as string | undefined;
    if (!token) {
      throw new UnauthorizedException('Not logged in.');
    }

    let payload: SessionPayload;
    try {
      payload = this.jwtService.verify<SessionPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid session.');
    }

    req.user = { id: user.id, githubLogin: user.githubLogin, tier: user.tier };
    return true;
  }
}
