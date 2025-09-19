import express from 'express';

import { appErrorHandler } from '@/middleware/error';
import { opampController } from '@/opamp/controllers/opampController';

// Create Express application
const app = express();

const OTEL_BASE_PATH = process.env.HYPERDX_OTEL_BASE_PATH || '';

app.disable('x-powered-by');

// Special body parser setup for OpAMP
app.use(
  `${OTEL_BASE_PATH}/v1/opamp`,
  express.raw({
    type: 'application/x-protobuf',
    limit: '10mb',
  }),
);

// OpAMP endpoint
app.post(`${OTEL_BASE_PATH}/v1/opamp`, opampController.handleOpampMessage.bind(opampController));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Error handling
app.use(appErrorHandler);

export default app;
