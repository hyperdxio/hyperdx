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
// (e.g. 'request.aborted', 'entity.too.large', 'entity.parse.failed') and set
// code 'ECONNABORTED' when the client hangs up mid-body. Both are bounded,
// low-cardinality values safe to use as a metric dimension.
type BodyParserError = {
  type?: unknown;
  code?: unknown;
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
 */
export const isClientDisconnect = (err: unknown): boolean =>
  bodyParserErrorType(err) === 'request.aborted' ||
  (err as BodyParserError)?.code === 'ECONNABORTED';

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
    error_type: parserErrorType ?? err.name ?? 'unknown',
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
