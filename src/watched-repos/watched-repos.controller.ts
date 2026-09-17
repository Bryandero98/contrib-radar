import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtCookieAuthGuard } from '../auth/jwt-cookie-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { WRITE_THROTTLE } from '../common/write-throttle';
import { CreateWatchedRepoDto } from './dto/create-watched-repo.dto';
import { WatchedRepoDto } from './dto/watched-repo.dto';
import { WatchedReposService } from './watched-repos.service';

@ApiTags('watched-repos')
@UseGuards(JwtCookieAuthGuard)
@Controller('repos')
export class WatchedReposController {
  constructor(private readonly watchedReposService: WatchedReposService) {}

  @Get()
  @ApiOperation({ summary: "List the logged-in user's watched repos" })
  @ApiOkResponse({ type: [WatchedRepoDto] })
  listWatchedRepos(@CurrentUser() user: AuthenticatedUser) {
    return this.watchedReposService.listWatchedRepos(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one watched repo by id' })
  @ApiOkResponse({ type: WatchedRepoDto })
  getWatchedRepo(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.watchedReposService.getWatchedRepo(id, user.id);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Watch a repo for scored issues - idempotent, returns the existing row if this owner/name is already watched. Free tier is capped at 3.',
  })
  @ApiCreatedResponse({ type: WatchedRepoDto })
  addWatchedRepo(
    @Body() body: CreateWatchedRepoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.watchedReposService.addWatchedRepo(
      user.id,
      user.tier,
      body.owner,
      body.name,
      body.labelFilter,
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary: 'Stop watching a repo (cascades its scored issues)',
  })
  @ApiNoContentResponse()
  removeWatchedRepo(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.watchedReposService.removeWatchedRepo(id, user.id);
  }
}
