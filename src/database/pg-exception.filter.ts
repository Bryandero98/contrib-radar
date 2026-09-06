import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import type { Response } from 'express';

/** The shape of the real pg error Drizzle nests under DrizzleQueryError.cause. */
interface PgDriverError {
  code?: string;
  detail?: string;
  column?: string;
  message: string;
}

// Structural check, not `instanceof DatabaseError` from the `pg` package -
// Drizzle's node-postgres driver wraps the real pg error as
// DrizzleQueryError, with the actual error (code, detail, column) nested
// under `.cause`, typed only as a loose `Error`. Duck-typing the cause
// instead of asserting a class means this keeps working even if some
// future dependency bump resolves a second copy of `pg`.
function isPgDriverError(error: unknown): error is PgDriverError {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  );
}

// Drizzle lets Postgres's own constraint errors (missing required field,
// duplicate primary key) bubble straight up from the insert call -
// uncaught, they'd otherwise surface to API clients as a bare 500 instead
// of a response they can act on. Mapped by Postgres's own SQLSTATE codes:
// https://www.postgresql.org/docs/current/errcodes-appendix.html
@Catch(DrizzleQueryError)
export class PgExceptionFilter implements ExceptionFilter {
  catch(error: DrizzleQueryError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.toHttpException(error);
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private toHttpException(error: DrizzleQueryError): HttpException {
    const cause = error.cause;
    if (!isPgDriverError(cause)) {
      return new BadRequestException(error.message);
    }

    switch (cause.code) {
      case '23505': // unique_violation
        return new ConflictException(cause.detail ?? cause.message);
      case '23502': // not_null_violation
        return new BadRequestException(
          cause.column
            ? `missing required field: ${cause.column}`
            : cause.message,
        );
      case '23503': // foreign_key_violation
      case '23514': // check_violation
        return new BadRequestException(cause.detail ?? cause.message);
      default:
        return new BadRequestException(cause.detail ?? cause.message);
    }
  }
}
