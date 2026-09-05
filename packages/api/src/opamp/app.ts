import express from 'express';

import { appErrorHandler } from '@/middleware/error';
import { opampController } from '@/opamp/controllers/opampController';
import { isMongoConnected, mongoReadyStateName } from '@/utils/readiness';

// Create Express application
const app = express();

app.disable('x-powered-by');

// Special body parser setup for OpAMP
app.use(
  '/v1/opamp',
  express.raw({
    type: 'application/x-protobuf',
    limit: '10mb',
  }),
);

// OpAMP endpoint
app.post('/v1/opamp', opampController.handleOpampMessage.bind(opampController));

// Liveness: 200 whenever the process can serve HTTP (no dependency checks).
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Readiness: the OpAMP handler is entirely Mongo-backed — without a Mongo
// connection every /v1/opamp request 500s, which crash-loops collectors that
// need a remote config at startup (see utils/readiness.ts and
// https://github.com/hyperdxio/hyperdx/issues/2966).
app.get('/ready', (req, res) => {
  if (isMongoConnected()) {
    return res.status(200).json({ status: 'OK' });
  }
  res.status(503).json({
    status: 'unavailable',
    mongo: mongoReadyStateName(),
  });
});

// Error handling
app.use(appErrorHandler);

export default app;
