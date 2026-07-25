import { configureRuntimeEnv } from 'next-runtime-env/build/configure.js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8'),
);
const { version } = packageJson;

// Generate public/whats-new.json — the latest release's feature headlines that
// the Help menu's "What's new" section fetches as a small static asset (instead
// of shipping the whole, ever-growing CHANGELOG.md). Done here (rather than a
// package.json pre-script) because Yarn 4 does not run arbitrary pre/post
// lifecycle scripts; next.config is evaluated by both `next dev` (Turbopack) and
// `next build` (Webpack), so this runs in every build mode. The ClickStack
// static export additionally needs `whats-new.json` allow-listed in
// scripts/prepare-clickhouse-build-export.js, and the Docker builder stages must
// COPY CHANGELOG.md, scripts/ and whats-new-highlights.json in as build inputs
// (see the Dockerfiles).
//
// The parser is imported dynamically, inside the try, on purpose. A static
// top-level import is resolved before this module's body runs, so it would be
// unguardable: the prod image copies next.config.mjs on its own and re-evaluates
// it under `next start`, where no build sources are present — a static import
// there crashes the container on startup instead of harmlessly falling through
// to the already-generated public/whats-new.json.
try {
  const { default: parseWhatsNew } = await import(
    './scripts/parse-whats-new.js'
  );
  const changelog = readFileSync(join(__dirname, 'CHANGELOG.md'), 'utf-8');
  const { releases } = parseWhatsNew(changelog, { maxReleases: 5 });

  // Optional hand-authored highlights, keyed by version — merged onto the
  // matching release so the "What's new" drawer can show a richer hero card.
  let highlights = {};
  try {
    highlights = JSON.parse(
      readFileSync(join(__dirname, 'whats-new-highlights.json'), 'utf-8'),
    );
  } catch (err) {
    // No highlights authored is fine — releases just render without them. A
    // file that exists but doesn't parse is not: swallowing that would silently
    // drop every hero card over a stray comma, so let it reach the outer
    // handler (which fails a production build and warns otherwise).
    if (err.code !== 'ENOENT') throw err;
  }

  // A key that matches no emitted release is almost always a typo or a release
  // that has aged out of the window — either way the card silently never shows,
  // so say so at build time.
  const versions = new Set(releases.map(r => r.version));
  for (const key of Object.keys(highlights)) {
    if (!versions.has(key)) {
      console.warn(
        `whats-new-highlights.json: no release "${key}" in the latest ${releases.length} — its highlight will not be shown.`,
      );
    }
  }

  writeFileSync(
    join(__dirname, 'public', 'whats-new.json'),
    JSON.stringify({
      releases: releases.map(r =>
        highlights[r.version] ? { ...r, highlight: highlights[r.version] } : r,
      ),
    }),
  );
} catch (err) {
  // Fail loudly during a production build: a missing CHANGELOG.md there means
  // the shipped image would silently render an empty "What's new" for every
  // user. Stay non-fatal otherwise — `next start` re-evaluates this config at
  // runtime where the source file is absent but public/whats-new.json already
  // exists from the build stage, and dev tolerates its absence.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    throw new Error(
      `Failed to generate whats-new.json during build: ${err.message}`,
    );
  }
  console.warn('Could not generate public/whats-new.json:', err.message);
}

// Support legacy consumers of next-runtime-env that expect this value under window.__ENV
process.env.NEXT_PUBLIC_APP_VERSION = version;

configureRuntimeEnv();

const basePath = process.env.NEXT_PUBLIC_HYPERDX_BASE_PATH;

const nextConfig = {
  // Allow overriding the build/dev output directory to avoid lock conflicts
  // when running dev and E2E simultaneously (e.g. NEXT_DIST_DIR=.next-e2e)
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
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
    // Outside of Vercel preview deployments, the `/api/[...all]` catch-all
    // proxies to a separately-deployed API service and never imports the
    // `@hyperdx/api` package at runtime. Mark it (and its subpaths) as a
    // CommonJS external so production app builds (Docker fullstack image,
    // standalone Next output) stay byte-for-byte equivalent to today and
    // do not pull in passport-saml, mongoose, AWS SDK, etc.
    ...(process.env.HDX_PREVIEW_INLINE_API !== 'true' ? ['@hyperdx/api'] : []),
  ],
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
  // Dev uses Turbopack; production build uses Webpack (--webpack).
  // Reason: Turbopack has CSS module parsing issues with nested :global syntax
  // used in styles/SearchPage.module.scss and other SCSS files.
  // TODO: single bundler when Turbopack CSS is solid.
  // Ignore otel warnings (Webpack): https://github.com/open-telemetry/opentelemetry-js/issues/4173#issuecomment-1822938936
  webpack: (
    config,
    { buildId, dev, isServer, defaultLoaders, nextRuntime, webpack },
  ) => {
    if (isServer) {
      config.ignoreWarnings = [{ module: /opentelemetry/ }];

      if (process.env.HDX_PREVIEW_INLINE_API !== 'true') {
        config.externals = [
          ...(config.externals ?? []),
          ({ request }, callback) => {
            if (
              request === '@hyperdx/api' ||
              request?.startsWith?.('@hyperdx/api/')
            ) {
              return callback(null, `commonjs ${request}`);
            }
            return callback();
          },
        ];
      }
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
          ...(process.env.NEXT_PUBLIC_NOINDEX === 'true'
            ? [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]
            : []),
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
