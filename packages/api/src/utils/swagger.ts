import { Application, Express } from 'express';
import fs from 'fs';
import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

export const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'HyperDX External API',
      description: 'API for managing HyperDX alerts and dashboards',
      version: '2.0.0',
    },
    servers: [
      {
        url: 'https://api.hyperdx.io',
        description: 'Production API server',
      },
      {
        url: '/',
        description: 'Current server',
      },
    ],
    tags: [
      {
        name: 'Dashboards',
        description:
          'Endpoints for managing dashboards and their visualizations',
      },
      {
        name: 'Alerts',
        description: 'Endpoints for managing monitoring alerts',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
        },
      },
    },
    security: [
      {
        BearerAuth: [],
      },
    ],
  },
  apis: ['./src/routers/external-api/**/*.ts'], // Path to the API routes files
};

export function setupSwagger(app: Application) {
  const specs = swaggerJsdoc(swaggerOptions);

  // Serve swagger docs
  app.use('/api/v2/docs', swaggerUi.serve, swaggerUi.setup(specs));

  // Serve OpenAPI spec as JSON (needed for ReDoc)
  app.get('/api/v2/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });

  // Optionally save the spec to a file
  const outputPath = path.resolve(__dirname, '../../../public/openapi.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(specs, null, 2));
}
