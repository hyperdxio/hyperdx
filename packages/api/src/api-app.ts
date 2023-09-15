import MongoStore from 'connect-mongo';
import compression from 'compression';
import express from 'express';
import ms from 'ms';
import onHeaders from 'on-headers';
import session from 'express-session';

import * as config from './config';
import defaultCors from './middleware/cors';
import passport from './utils/passport';
import routers from './routers/api';
import usageStats from './tasks/usageStats';
import { appErrorHandler } from './middleware/error';
import { expressLogger } from './utils/logger';

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

app.use(passport.initialize());
app.use(passport.session());

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
app.use('/', routers.rootRouter);
app.use('/alerts', routers.alertsRouter);
app.use('/dashboards', routers.dashboardRouter);
app.use('/log-views', routers.logViewsRouter);
app.use('/logs', routers.logsRouter);
app.use('/metrics', routers.metricsRouter);
app.use('/sessions', routers.sessionsRouter);
app.use('/team', routers.teamRouter);
app.use('/webhooks', routers.webhooksRouter);
// ---------------------------------------------------------------------

// error handling
app.use(appErrorHandler);

export default app;
