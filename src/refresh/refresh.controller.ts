import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { WRITE_THROTTLE } from '../common/write-throttle';
import { RefreshService } from './refresh.service';

@ApiTags('refresh')
@Controller('repos')
export class RefreshController {
  constructor(private readonly refreshService: RefreshService) {}

  @Post(':id/refresh')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Refresh scored issues for a watched repo - a 5-minute cooldown returns the cached snapshot instead of re-hitting GitHub/Gemini',
  })
  @ApiOkResponse({
    description:
      '{ refreshed: boolean, issueCount: number } - refreshed:false means the cooldown was still active',
  })
  refresh(@Param('id') id: string) {
    return this.refreshService.refreshWatchedRepo(id);
  }
}
