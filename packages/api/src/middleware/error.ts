import { recordException } from '@hyperdx/node-opentelemetry';
import type { NextFunction, Request, Response } from 'express';

import { IS_PROD } from '@/config';
import { BaseError, isOperationalError, StatusCode } from '@/utils/errors';

// WARNING: need to keep the 4th arg for express to identify it as an error-handling middleware function
export const appErrorHandler = (
  err: BaseError,
  _: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!IS_PROD) {
    console.error(err);
  }

  const userFacingErrorMessage = isOperationalError(err)
    ? err.name || err.message
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
