import { configureRuntimeEnv } from 'next-runtime-env/build/configure.js';
import nextra from 'nextra';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8')
);
const { version } = packageJson;

configureRuntimeEnv();

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './src/nextra.config.tsx',
});

const basePath = process.env.NEXT_PUBLIC_HYPERDX_BASE_PATH;

const nextConfig = {
  reactCompiler: true,
  basePath: basePath,
  // External packages to prevent bundling issues (moved from experimental in Next.js 15+)
  // https://github.com/open-telemetry/opentelemetry-js/issues/4297#issuecomment-2285070503
  serverExternalPackages: [
    '@opentelemetry/instrumentation',
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@hyperdx/node-opentelemetry',
    '@hyperdx/instrumentation-sentry-node',
  ],
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  // NOTE: Using Webpack instead of Turbopack (Next.js 16 default)
  // Reason: Turbopack has CSS module parsing issues with nested :global syntax
  // used in styles/SearchPage.module.scss and other SCSS files.
  // The --webpack flag is added to dev and build scripts in package.json.
  // TODO: Re-evaluate when Turbopack CSS module support improves
  // Ignore otel pkgs warnings
  // https://github.com/open-telemetry/opentelemetry-js/issues/4173#issuecomment-1822938936
  webpack: (config, { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack }) => {
    if (isServer) {
      config.ignoreWarnings = [{ module: /opentelemetry/ }];
    }
    return config;
  },
  ...withNextra({
    async headers() {
      return [
        {
          source: '/(.*)?', // Matches all pages
          headers: [
            {
              key: 'X-Frame-Options',
              value: 'DENY',
            },
          ],
        },
      ];
    },
    productionBrowserSourceMaps: false,
    ...(process.env.NEXT_OUTPUT_STANDALONE === 'true'
      ? {
          output: 'standalone',
        }
      : {}),
  }),
};

export default nextConfig;

