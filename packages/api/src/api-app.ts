import compression from 'compression';
import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
import ms from 'ms';
import onHeaders from 'on-headers';

import * as config from './config';
import { isUserAuthenticated } from './middleware/auth';
import defaultCors from './middleware/cors';
import { appErrorHandler } from './middleware/error';
import routers from './routers/api';
import clickhouseProxyRouter from './routers/api/clickhouseProxy';
import connectionsRouter from './routers/api/connections';
import savedSearchRouter from './routers/api/savedSearch';
import sourcesRouter from './routers/api/sources';
import externalRoutersV1 from './routers/external-api/v1';
import usageStats from './tasks/usageStats';
import { expressLogger } from './utils/logger';
import passport from './utils/passport';

const app: express.Application = express();

const sess: session.SessionOptions & { cookie: session.CookieOptions } = {
  resave: false,
  saveUninitialized: false,
  secret: config.EXPRESS_SESSION_SECRET,
  cookie: {
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
  rolling: true,
  store: new MongoStore({ mongoUrl: config.MONGO_URI }),
};

app.set('trust proxy', 1);
if (!config.IS_CI && config.FRONTEND_URL) {
  const feUrl = new URL(config.FRONTEND_URL);
  sess.cookie.domain = feUrl.hostname;
  if (feUrl.protocol === 'https:') {
    sess.cookie.secure = true;
  }
}

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '32mb' }));
app.use(express.text({ limit: '32mb' }));
app.use(express.urlencoded({ extended: false, limit: '32mb' }));
app.use(session(sess));

if (!config.IS_LOCAL_APP_MODE) {
  app.use(passport.initialize());
  app.use(passport.session());
}

app.use(expressLogger);
// Allows timing data from frontend package
// see: https://github.com/expressjs/cors/issues/102
app.use(function (req, res, next) {
  onHeaders(res, function () {
    const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
    if (allowOrigin) {
      res.setHeader('Timing-Allow-Origin', allowOrigin);
    }
  });
  next();
});
app.use(defaultCors);

// ---------------------------------------------------------------------
// ----------------------- Background Jobs -----------------------------
// ---------------------------------------------------------------------
if (config.USAGE_STATS_ENABLED) {
  void usageStats();
  setInterval(() => {
    void usageStats();
  }, ms('4h'));
}
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// ----------------------- Internal Routers ----------------------------
// ---------------------------------------------------------------------
// PUBLIC ROUTES
app.use('/', routers.rootRouter);

// PRIVATE ROUTES
app.use('/alerts', isUserAuthenticated, routers.alertsRouter);
app.use('/dashboards', isUserAuthenticated, routers.dashboardRouter);
app.use('/logs', isUserAuthenticated, routers.logsRouter);
app.use('/me', isUserAuthenticated, routers.meRouter);
app.use('/metrics', isUserAuthenticated, routers.metricsRouter);
app.use('/sessions', isUserAuthenticated, routers.sessionsRouter);
app.use('/team', isUserAuthenticated, routers.teamRouter);
app.use('/webhooks', isUserAuthenticated, routers.webhooksRouter);
app.use('/chart', isUserAuthenticated, routers.chartRouter);
app.use('/datasources', isUserAuthenticated, routers.datasourceRouter);
app.use('/connections', isUserAuthenticated, connectionsRouter);
app.use('/sources', isUserAuthenticated, sourcesRouter);
app.use('/saved-search', isUserAuthenticated, savedSearchRouter);
app.use('/clickhouse-proxy', isUserAuthenticated, clickhouseProxyRouter);
// ---------------------------------------------------------------------

// TODO: Separate external API routers from internal routers
// ---------------------------------------------------------------------
// ----------------------- External Routers ----------------------------
// ---------------------------------------------------------------------
// API v1
app.use('/api/v1', externalRoutersV1);

// error handling
app.use(appErrorHandler);

export default app;
