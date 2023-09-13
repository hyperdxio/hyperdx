import compression from 'compression';
import express from 'express';

import * as clickhouse from './clickhouse';
import logger, { expressLogger } from './utils/logger';
import routers from './routers/aggregator';
import { appErrorHandler } from './middleware/error';
import { mongooseConnection } from './models';

import type { Request, Response, NextFunction } from 'express';

const app: express.Application = express();

const healthCheckMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (mongooseConnection.readyState !== 1) {
    logger.error('MongoDB is down!');
    return res.status(500).send('MongoDB is down!');
  }

  try {
    await clickhouse.healthCheck();
  } catch (e) {
    logger.error('Clickhouse is down!');
    return res.status(500).send('Clickhouse is down!');
  }
  next();
};

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '64mb' }));
app.use(express.text({ limit: '64mb' }));
app.use(express.urlencoded({ extended: false, limit: '64mb' }));

app.use(expressLogger);

// ---------------------------------------------------------
// -------------------- Routers ----------------------------
// ---------------------------------------------------------
app.use('/', healthCheckMiddleware, routers.rootRouter);
// ---------------------------------------------------------

// error handling
app.use(appErrorHandler);

export default app;
