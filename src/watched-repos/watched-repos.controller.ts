import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WRITE_THROTTLE } from '../common/write-throttle';
import { CreateWatchedRepoDto } from './dto/create-watched-repo.dto';
import { WatchedRepoDto } from './dto/watched-repo.dto';
import { WatchedReposService } from './watched-repos.service';

@ApiTags('watched-repos')
@Controller('repos')
export class WatchedReposController {
  constructor(private readonly watchedReposService: WatchedReposService) {}

  @Get()
  @ApiOperation({ summary: 'List every watched repo' })
  @ApiOkResponse({ type: [WatchedRepoDto] })
  listWatchedRepos() {
    return this.watchedReposService.listWatchedRepos();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one watched repo by id' })
  @ApiOkResponse({ type: WatchedRepoDto })
  getWatchedRepo(@Param('id') id: string) {
    return this.watchedReposService.getWatchedRepo(id);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Watch a repo for scored issues - idempotent, returns the existing row if this owner/name is already watched',
  })
  @ApiCreatedResponse({ type: WatchedRepoDto })
  addWatchedRepo(@Body() body: CreateWatchedRepoDto) {
    return this.watchedReposService.addWatchedRepo(
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
  removeWatchedRepo(@Param('id') id: string) {
    return this.watchedReposService.removeWatchedRepo(id);
  }
}
