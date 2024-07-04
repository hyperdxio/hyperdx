import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { serializeError } from 'serialize-error';

import * as clickhouse from './clickhouse';
import * as config from './config';
import { mongooseConnection } from './models';
import routers from './routers/aggregator';
import { BaseError, StatusCode } from './utils/errors';
import logger, { expressLogger } from './utils/logger';

const app: express.Application = express();

const healthCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (mongooseConnection.readyState !== 1) {
    logger.error('MongoDB is down!');
    return res.status(StatusCode.INTERNAL_SERVER).send('MongoDB is down!');
  }

  try {
    await clickhouse.healthCheck();
  } catch (e) {
    logger.error('Clickhouse is down!');
    return res.status(StatusCode.INTERNAL_SERVER).send('Clickhouse is down!');
  }
  next();
};

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: config.AGGREGATOR_PAYLOAD_SIZE_LIMIT })); // WARNING: should be greater than the upstream batch size limit
app.use(express.text({ limit: config.AGGREGATOR_PAYLOAD_SIZE_LIMIT }));
app.use(
  express.urlencoded({
    extended: false,
    limit: config.AGGREGATOR_PAYLOAD_SIZE_LIMIT,
  }),
);

app.use(expressLogger);

// ---------------------------------------------------------
// -------------------- Routers ----------------------------
// ---------------------------------------------------------
app.use('/', healthCheckMiddleware, routers.rootRouter);
// ---------------------------------------------------------

// error handling
app.use((err: BaseError, _: Request, res: Response, next: NextFunction) => {
  logger.error({
    location: 'appErrorHandler',
    error: serializeError(err),
  });
  // WARNING: should always return 500 so the ingestor will queue logs
  res.status(StatusCode.INTERNAL_SERVER).send('Something broke!');
});

export default app;
