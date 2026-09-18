import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtCookieAuthGuard } from '../auth/jwt-cookie-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { WRITE_THROTTLE } from '../common/write-throttle';
import { ClaimAssistantService } from './claim-assistant.service';
import { DraftClaimDto } from './dto/draft-claim.dto';

@ApiTags('claims')
@UseGuards(JwtCookieAuthGuard)
@Controller('claims')
export class ClaimAssistantController {
  constructor(private readonly claimAssistantService: ClaimAssistantService) {}

  @Get()
  @ApiOperation({ summary: 'List claim drafts for a watched repo' })
  @ApiQuery({ name: 'watchedRepoId', required: true })
  @ApiOkResponse()
  listDrafts(
    @Query('watchedRepoId') watchedRepoId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claimAssistantService.listDrafts(watchedRepoId, user.id);
  }

  @Post()
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Run the deterministic gate, then (if it passes) the LLM decision, for one scored issue - never posts anything to GitHub by itself.',
  })
  @ApiOkResponse()
  draftClaim(
    @Body() body: DraftClaimDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.claimAssistantService.draftClaim(
      body.watchedRepoId,
      body.issueNumber,
      user.id,
    );
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Re-checks the gate against current data, then posts the draft comment to the real GitHub issue.',
  })
  @ApiOkResponse()
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claimAssistantService.approve(id, user.id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Discards a draft - never touches GitHub.' })
  @ApiOkResponse()
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.claimAssistantService.reject(id, user.id);
  }
}
