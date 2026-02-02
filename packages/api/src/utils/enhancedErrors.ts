import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';

/**
 * Formats a Zod error into a single concatenated error message
 * @param error - The Zod error to format
 * @returns A single string with all validation errors
 */
function formatZodError(error: ZodError): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

/**
 * Custom validation middleware that validates multiple parts of the request
 * and sends concatenated error message
 * @param schemas - Object containing schemas for body, params, and/or query
 * @returns Express middleware function
 */
export function validateRequestWithEnhancedErrors(schemas: {
  body?: z.ZodSchema;
  params?: z.ZodSchema;
  query?: z.ZodSchema;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push(`Body validation failed: ${formatZodError(result.error)}`);
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push(
          `Params validation failed: ${formatZodError(result.error)}`,
        );
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push(`Query validation failed: ${formatZodError(result.error)}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        message: errors.join('; '),
      });
    }

    next();
  };
}
