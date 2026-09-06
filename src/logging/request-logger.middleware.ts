import { randomUUID } from 'crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// One JSON line per request, to stdout - the shape any real log
// aggregator (CloudWatch, Datadog, a self-hosted Loki, or just `| jq`
// locally) already knows how to parse, instead of Nest's default
// human-readable console format that's fine for local dev but useless
// for grepping/alerting once this runs somewhere real. The request id is
// also echoed back as X-Request-Id, so a caller reporting "this refresh
// call failed" gives you the exact line to grep for instead of a
// timestamp-and-hope.
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const line = {
        timestamp: new Date().toISOString(),
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      };
      console.log(JSON.stringify(line));
    });

    next();
  }
}
