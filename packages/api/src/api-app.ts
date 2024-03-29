import * as Sentry from '@sentry/node';
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
import externalRoutersV1 from './routers/external-api/v1';
import usageStats from './tasks/usageStats';
import { expressLogger } from './utils/logger';
import passport from './utils/passport';

const app: express.Application = express();

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: config.CODE_VERSION,
  });

  Sentry.setContext('hyperdx', {
    serviceName: config.OTEL_SERVICE_NAME,
  });
}

// RequestHandler creates a separate execution context using domains, so that every
// transaction/span/breadcrumb is attached to its own Hub instance
app.use(Sentry.Handlers.requestHandler());

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

if (config.IS_PROD) {
  app.set('trust proxy', 1); // Super important or cookies don't get set in prod
  sess.cookie.secure = true;
  sess.cookie.domain = config.COOKIE_DOMAIN;
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
app.use('/log-views', isUserAuthenticated, routers.logViewsRouter);
app.use('/logs', isUserAuthenticated, routers.logsRouter);
app.use('/me', isUserAuthenticated, routers.meRouter);
app.use('/metrics', isUserAuthenticated, routers.metricsRouter);
app.use('/sessions', isUserAuthenticated, routers.sessionsRouter);
app.use('/team', isUserAuthenticated, routers.teamRouter);
app.use('/webhooks', isUserAuthenticated, routers.webhooksRouter);
app.use('/chart', isUserAuthenticated, routers.chartRouter);
// ---------------------------------------------------------------------

// TODO: Separate external API routers from internal routers
// ---------------------------------------------------------------------
// ----------------------- External Routers ----------------------------
// ---------------------------------------------------------------------
// API v1
app.use('/api/v1', externalRoutersV1);
// ---------------------------------------------------------------------

// The error handler must be before any other error middleware and after all controllers
app.use(Sentry.Handlers.errorHandler());

// error handling
app.use(appErrorHandler);

export default app;
