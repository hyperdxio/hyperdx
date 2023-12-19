import type { NextFunction, Request, Response } from 'express';
import { serializeError } from 'serialize-error';

import { BaseError, isOperationalError, StatusCode } from '@/utils/errors';
import logger from '@/utils/logger';

// WARNING: need to keep the 4th arg for express to identify it as an error-handling middleware function
export const appErrorHandler = (
  err: BaseError,
  _: Request,
  res: Response,
  next: NextFunction,
) => {
  logger.error({
    location: 'appErrorHandler',
    error: serializeError(err),
  });

  const userFacingErrorMessage = isOperationalError(err)
    ? err.message
    : 'Something went wrong :(';

  if (!res.headersSent) {
    res
      .status(err.statusCode ?? StatusCode.INTERNAL_SERVER)
      .send(userFacingErrorMessage);
  }
};
