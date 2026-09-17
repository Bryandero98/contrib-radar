import { ForbiddenException } from '@nestjs/common';

// A well-formed HttpException, not a new global filter - PgExceptionFilter
// only maps Postgres SQLSTATE codes, this never reaches Postgres at all.
export class FreeTierLimitExceededException extends ForbiddenException {
  constructor() {
    super({
      message: 'Free tier is limited to 5 watched repos - upgrade to add more.',
      code: 'FREE_TIER_LIMIT_EXCEEDED',
    });
  }
}
