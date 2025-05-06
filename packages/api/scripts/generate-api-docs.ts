import fs from 'fs';
import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

import { swaggerOptions } from '../src/utils/swagger';

const specs = swaggerJsdoc(swaggerOptions);
const outputPath = path.resolve(__dirname, '../../public/openapi.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(specs, null, 2));

console.log(`OpenAPI specification written to ${outputPath}`);
