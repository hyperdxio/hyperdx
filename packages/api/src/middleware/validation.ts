import express from 'express';
import { z } from 'zod';

export function validateRequestHeaders<T extends z.Schema>(schema: T) {
  return function (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const parsed = schema.safeParse(req.headers);
    if (!parsed.success) {
      return res.status(400).json({ type: 'Headers', errors: parsed.error });
    }

    return next();
  };
}
