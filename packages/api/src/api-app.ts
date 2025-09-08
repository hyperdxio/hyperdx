import compression from 'compression';
import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
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
import externalRoutersV2 from './routers/external-api/v2';
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
    sameSite: 'lax',
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
  usageStats();
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
app.use('/me', isUserAuthenticated, routers.meRouter);
app.use('/team', isUserAuthenticated, routers.teamRouter);
app.use('/webhooks', isUserAuthenticated, routers.webhooksRouter);
app.use('/connections', isUserAuthenticated, connectionsRouter);
app.use('/sources', isUserAuthenticated, sourcesRouter);
app.use('/saved-search', isUserAuthenticated, savedSearchRouter);
app.use('/clickhouse-proxy', isUserAuthenticated, clickhouseProxyRouter);
// ---------------------------------------------------------------------

// TODO: Separate external API routers from internal routers
// ---------------------------------------------------------------------
// ----------------------- External Routers ----------------------------
// ---------------------------------------------------------------------
// API v2
// Only initialize Swagger in development or if explicitly enabled
if (
  process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_SWAGGER === 'true'
) {
  import('./utils/swagger')
    .then(({ setupSwagger }) => {
      console.log('Swagger UI setup and available at /api/v2/docs');
      setupSwagger(app);
    })
    .catch(error => {
      console.error(
        'Failed to dynamically load or setup Swagger. Swagger UI will not be available.',
        error,
      );
    });
}

app.use('/api/v2', externalRoutersV2);

// error handling
app.use(appErrorHandler);

export default app;
