import express from 'express';

import { appErrorHandler } from '@/middleware/error';
import { opampController } from '@/opamp/controllers/opampController';

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Error handling
app.use(appErrorHandler);

export default app;
