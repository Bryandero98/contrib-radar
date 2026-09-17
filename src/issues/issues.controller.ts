import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtCookieAuthGuard } from '../auth/jwt-cookie-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { WatchedReposService } from '../watched-repos/watched-repos.service';
import { IssuesService, type IssueSort } from './issues.service';

@ApiTags('issues')
@UseGuards(JwtCookieAuthGuard)
@Controller('repos')
export class IssuesController {
  constructor(
    private readonly issuesService: IssuesService,
    private readonly watchedReposService: WatchedReposService,
  ) {}

  @Get(':id/issues')
  @ApiOperation({
    summary:
      'List scored issues for a watched repo, highest-opportunity first by default',
  })
  @ApiQuery({ name: 'sort', required: false, enum: ['score', 'updated'] })
  @ApiOkResponse()
  async listScoredIssues(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('sort') sort?: IssueSort,
  ) {
    // issue_scores has no user_id of its own (not denormalized) - ownership
    // is proven by successfully loading the parent watched_repos row first.
    await this.watchedReposService.getWatchedRepo(id, user.id);
    return this.issuesService.listScoredIssues(id, sort);
  }
}
