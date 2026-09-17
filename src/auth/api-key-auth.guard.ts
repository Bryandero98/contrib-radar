import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';

// Guards the MCP server (mcp.controller.ts) - an agent has no browser
// cookie, so it authenticates with the per-user API key generated via
// POST /users/me/api-key instead.
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const apiKey = req.header('X-Api-Key');
    if (!apiKey) {
      throw new UnauthorizedException('Missing X-Api-Key header.');
    }

    const user = await this.usersService.findByApiKey(apiKey);
    if (!user) {
      throw new UnauthorizedException('Invalid API key.');
    }

    req.user = { id: user.id, githubLogin: user.githubLogin, tier: user.tier };
    return true;
  }
}
