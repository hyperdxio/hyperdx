// Preload .env.development.local (if it exists) before dotenv-expand loads
// .env.development. Because dotenv never overwrites existing vars, values
// from the .local file take precedence — matching the Next.js convention.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const localPath = path.resolve(
  __dirname,
  '..',
  (process.env.DOTENV_CONFIG_PATH || '.env.development') + '.local',
);

if (fs.existsSync(localPath)) {
  dotenv.config({ path: localPath });
}
