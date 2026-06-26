import { recordException } from '@hyperdx/node-opentelemetry';
import type { NextFunction, Request, Response } from 'express';

import { IS_PROD } from '@/config';
import { BaseError, isOperationalError, StatusCode } from '@/utils/errors';
import { getCounter } from '@/utils/instrumentation';
import logger from '@/utils/logger';

const apiErrorCounter = getCounter('hyperdx.api.errors', {
  description:
    'Count of errors handled by the API error middleware, labeled by operational flag and HTTP status code.',
});

// WARNING: need to keep the 4th arg for express to identify it as an error-handling middleware function
export const appErrorHandler = (
  err: BaseError,
  _: Request,
  res: Response,
  next: NextFunction,
) => {
  const operational = isOperationalError(err);
  const statusCode = err.statusCode ?? StatusCode.INTERNAL_SERVER;
  apiErrorCounter.add(1, {
    operational,
    status_code: statusCode,
  });

  if (operational) {
    logger.warn({ err }, err.message);
  } else {
    logger.error({ err }, err.message);
  }

  const userFacingErrorMessage = operational
    ? err.name || err.message
    : err instanceof SyntaxError && err.message.includes('JSON')
      ? 'Invalid JSON payload'
      : 'Something went wrong :(';

  void recordException(err, {
    mechanism: {
      type: 'generic',
      handled: userFacingErrorMessage ? true : false,
    },
  });

  if (!res.headersSent) {
    res.status(statusCode).json({
      message: userFacingErrorMessage,
    });
  }
};
