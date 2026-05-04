import { recordException } from '@hyperdx/node-opentelemetry';
import type { NextFunction, Request, Response } from 'express';

import { IS_PROD } from '@/config';
import { BaseError, isOperationalError, StatusCode } from '@/utils/errors';
import logger from '@/utils/logger';

// WARNING: need to keep the 4th arg for express to identify it as an error-handling middleware function
export const appErrorHandler = (
  err: BaseError,
  _: Request,
  res: Response,
  next: NextFunction,
) => {
  if (isOperationalError(err)) {
    logger.warn({ err }, err.message);
  } else {
    logger.error({ err }, err.message);
  }

  const userFacingErrorMessage = isOperationalError(err)
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
    res.status(err.statusCode ?? StatusCode.INTERNAL_SERVER).json({
      message: userFacingErrorMessage,
    });
  }
};
