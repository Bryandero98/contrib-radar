import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtCookieAuthGuard } from '../auth/jwt-cookie-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { WRITE_THROTTLE } from '../common/write-throttle';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(JwtCookieAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('me/api-key')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      "Generate (or rotate) the logged-in user's MCP API key - the raw key is only ever shown in this response, never again.",
  })
  @ApiOkResponse({ description: '{ apiKey: string }' })
  async generateApiKey(@CurrentUser() user: AuthenticatedUser) {
    const apiKey = await this.usersService.generateApiKey(user.id);
    return { apiKey };
  }
}
