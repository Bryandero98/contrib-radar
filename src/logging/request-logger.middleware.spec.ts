import { EventEmitter } from 'events';
import { RequestLoggerMiddleware } from './request-logger.middleware';

// A minimal fake Request/Response - real Express objects need a full
// server to construct meaningfully, and this middleware only ever
// touches `res.setHeader`, `res.on('finish', ...)`, `res.statusCode`,
// `req.method`, and `req.originalUrl`. EventEmitter gives a real
// `res.on`/`.emit` pair instead of a hand-rolled stub of Express's own
// event semantics.
function makeRes(statusCode: number) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    setHeader: jest.Mock;
  };
  res.statusCode = statusCode;
  res.setHeader = jest.fn();
  return res;
}

describe('RequestLoggerMiddleware', () => {
  let logSpy: jest.SpyInstance;
  // Captured directly by the mock implementation, typed as `unknown` -
  // avoids indexing `logSpy.mock.calls`, whose element type comes from
  // console.log's own `any`-typed signature and can't be narrowed by a
  // cast on the read side.
  let loggedLine: unknown;

  beforeEach(() => {
    loggedLine = undefined;
    logSpy = jest.spyOn(console, 'log').mockImplementation((line: unknown) => {
      loggedLine = line;
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('sets an X-Request-Id header and calls next()', () => {
    const middleware = new RequestLoggerMiddleware();
    const req = {
      method: 'GET',
      originalUrl: '/repos',
    } as unknown as Parameters<RequestLoggerMiddleware['use']>[0];
    const res = makeRes(200);
    const next = jest.fn();

    middleware.use(req, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.any(String),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('logs one JSON line with method/path/statusCode/requestId when the response finishes', () => {
    const middleware = new RequestLoggerMiddleware();
    const req = {
      method: 'POST',
      originalUrl: '/repos/abc123/refresh',
    } as unknown as Parameters<RequestLoggerMiddleware['use']>[0];
    const res = makeRes(200);
    const next = jest.fn();

    middleware.use(req, res as never, next);
    res.emit('finish');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(loggedLine as string) as {
      method: string;
      path: string;
      statusCode: number;
      requestId: string;
      durationMs: number;
    };
    expect(logged).toMatchObject({
      method: 'POST',
      path: '/repos/abc123/refresh',
      statusCode: 200,
    });
    expect(typeof logged.requestId).toBe('string');
    expect(typeof logged.durationMs).toBe('number');
  });
});
