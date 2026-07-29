import { recordException } from '@hyperdx/node-opentelemetry';
import { trace } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

import { IS_PROD } from '@/config';
import { BaseError, isOperationalError, StatusCode } from '@/utils/errors';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

const apiErrorCounter = getCounter('hyperdx.api.errors', {
  description:
    'Count of errors handled by the API error middleware, labeled by operational flag, HTTP status code, and error type.',
});

// raw-body / body-parser attach a bounded string `type` on parse failures
// (e.g. 'request.aborted', 'entity.too.large', 'entity.parse.failed'). This is
// a bounded, low-cardinality value safe to use as a metric dimension.
type BodyParserError = {
  type?: unknown;
  received?: unknown;
  expected?: unknown;
};

const bodyParserErrorType = (err: unknown): string | undefined => {
  const type = (err as BodyParserError)?.type;
  return typeof type === 'string' ? type : undefined;
};

/**
 * A client that disconnects mid-request (aborted upload, LB read timeout,
 * collector restart) is not a server fault. We classify it as operational so
 * it stays out of the non-operational error signal and off the error log.
 *
 * We key strictly on body-parser's `type === 'request.aborted'` — deliberately
 * NOT on `code === 'ECONNABORTED'`, which is not scoped to the incoming request
 * (axios uses it for outbound request timeouts) and would otherwise silently
 * downgrade real server errors from any route.
 */
const isClientDisconnect = (err: unknown): boolean =>
  bodyParserErrorType(err) === 'request.aborted';

// WARNING: need to keep the 4th arg for express to identify it as an error-handling middleware function
export const appErrorHandler = (
  err: BaseError,
  _: Request,
  res: Response,
  next: NextFunction,
) => {
  const parserErrorType = bodyParserErrorType(err);
  const clientDisconnect = isClientDisconnect(err);
  const operational = clientDisconnect || isOperationalError(err);
  const statusCode = err.statusCode ?? StatusCode.INTERNAL_SERVER;
  apiErrorCounter.add(1, {
    operational,
    status_code: statusCode,
    // `err.name` on our BaseError subclasses is the constructor's first arg,
    // which is routinely an interpolated message (e.g. "Team not found for
    // user <id>") — unbounded. The class name is bounded; note BaseError's
    // setPrototypeOf collapses its subclasses to "BaseError" (the granular
    // distinction comes from status_code above).
    error_type: parserErrorType ?? err.constructor?.name ?? 'unknown',
  });

  // Attach connection-level context to the active span so a single trace shows
  // why the request failed and, for aborts, how far the upload got.
  const activeSpan = trace.getActiveSpan();
  if (activeSpan) {
    if (parserErrorType) {
      activeSpan.setAttribute('http.request_error.type', parserErrorType);
    }
    const { received, expected } = err as BodyParserError;
    if (clientDisconnect && typeof received === 'number') {
      activeSpan.setAttribute('http.request.received_bytes', received);
      if (typeof expected === 'number') {
        activeSpan.setAttribute('http.request.expected_bytes', expected);
      }
    }
  }

  if (clientDisconnect) {
    const { received, expected } = err as BodyParserError;
    logger.debug(
      { err, received, expected },
      'client disconnected mid-request',
    );
  } else if (operational) {
    logger.warn({ err }, err.message);
  } else {
    logger.error({ err }, err.message);
  }

  const userFacingErrorMessage = operational
    ? err.name || err.message
    : err instanceof SyntaxError && err.message.includes('JSON')
      ? 'Invalid JSON payload'
      : 'Something went wrong :(';

  // A client disconnect is expected background noise, not an exception worth
  // surfacing in error tracking (the auto-instrumented parser span already
  // recorded it), so we skip recordException for it.
  if (!clientDisconnect) {
    void recordException(err, {
      mechanism: {
        type: 'generic',
        handled: userFacingErrorMessage ? true : false,
      },
    });
  }

  if (!res.headersSent) {
    res.status(statusCode).json({
      message: userFacingErrorMessage,
    });
  }
};
