import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtCookieAuthGuard } from '../auth/jwt-cookie-auth.guard';
import type { AuthenticatedUser } from '../auth/types';
import { WRITE_THROTTLE } from '../common/write-throttle';
import { BillingService } from './billing.service';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @UseGuards(JwtCookieAuthGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary: 'Create a Stripe Checkout session to upgrade to Pro.',
  })
  @ApiOkResponse({ description: '{ url: string }' })
  async checkout(@CurrentUser() user: AuthenticatedUser) {
    const url = await this.billingService.createCheckoutSession(user.id);
    return { url };
  }

  @Post('portal')
  @UseGuards(JwtCookieAuthGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({
    summary:
      'Create a Stripe Customer Portal session (manage/cancel the Pro subscription).',
  })
  @ApiOkResponse({ description: '{ url: string }' })
  async portal(@CurrentUser() user: AuthenticatedUser) {
    const url = await this.billingService.createPortalSession(user.id);
    return { url };
  }

  // No session guard - Stripe calls this server-to-server with no cookie;
  // authenticity comes from the signature check inside
  // billingService.constructEvent, not from a guard here.
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  @ApiExcludeEndpoint()
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) {
      throw new Error('Raw body is missing - is rawBody:true set in main.ts?');
    }
    const event = this.billingService.constructEvent(req.rawBody, signature);
    await this.billingService.handleEvent(event);
    return { received: true };
  }
}
