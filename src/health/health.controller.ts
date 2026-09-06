import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { HealthService } from './health.service';

// Unauthenticated and unversioned - the one endpoint an uptime monitor or
// a container orchestrator's liveness probe needs to hit without setup.
// 503 (not 200-with-a-status-field) when the database is unreachable, so
// a naive "is this a 2xx" check still does the right thing. Exempt from
// the global rate limit for the same reason a monitor polls this.
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary:
      "Check the server's own health (database connectivity, GitHub token / sentiment provider config)",
  })
  @ApiOkResponse()
  async check(@Res({ passthrough: true }) res: Response) {
    const result = await this.healthService.check();
    res.status(
      result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
