import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DASHBOARD_HTML } from './dashboard.html';

// Excluded from Swagger (it's a page, not an API operation) and exempt
// from the global rate limit (a browser may reload it freely) - same
// reasoning as packetforge's DashboardController.
@SkipThrottle()
@ApiExcludeController()
@Controller('dashboard')
export class DashboardController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  serve(): string {
    return DASHBOARD_HTML;
  }
}
