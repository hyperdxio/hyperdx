import { configureRuntimeEnv } from 'next-runtime-env/build/configure.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8'),
);
const { version } = packageJson;

// Support legacy consumers of next-runtime-env that expect this value under window.__ENV
process.env.NEXT_PUBLIC_APP_VERSION = version;

configureRuntimeEnv();

const basePath = process.env.NEXT_PUBLIC_HYPERDX_BASE_PATH;

const nextConfig = {
  reactCompiler: true,
  basePath: basePath,
  env: {
    // Ensures bundler-time replacements for client/server code that references this env var
    NEXT_PUBLIC_APP_VERSION: version,
  },
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
  webpack: (
    config,
    { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack },
  ) => {
    if (isServer) {
      config.ignoreWarnings = [{ module: /opentelemetry/ }];
    }
    return config;
  },
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
  ...(process.env.NEXT_PUBLIC_CLICKHOUSE_BUILD
    ? {
        assetPrefix: '/clickstack',
        basePath: '/clickstack',
        images: { unoptimized: true },
        output: 'export',
      }
    : {}),
  logging: {
    incomingRequests: {
      // We also log this in the API server, so we don't want to log it twice.
      ignore: [/\/api\/.*/],
    },
  },
};

export default nextConfig;
