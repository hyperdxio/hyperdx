import { configureRuntimeEnv } from 'next-runtime-env/build/configure.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(__dirname, 'package.json'), 'utf-8'),
);
const { version } = packageJson;

// Generate public/whats-new.json — the recent releases' headlines that the Help
// menu's "What's new" section fetches as a small static asset (instead of
// shipping the whole, ever-growing changelog). Reads the repo-root CHANGELOG.md,
// the release-level summary, not the app-only package changelog. Done here
// (rather than a package.json pre-script) because Yarn 4 does not run arbitrary
// pre/post lifecycle scripts; next.config is evaluated by both `next dev`
// (Turbopack) and `next build` (Webpack), so this runs in every build mode. The
// ClickStack static export additionally needs `whats-new.json` allow-listed in
// scripts/prepare-clickhouse-build-export.js, and the Docker builder stages must
// COPY the root CHANGELOG.md and scripts/ in as build inputs (see the
// Dockerfiles).
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
  const changelog = readFileSync(
    join(__dirname, '..', '..', 'CHANGELOG.md'),
    'utf-8',
  );
  const { releases } = parseWhatsNew(changelog, { maxReleases: 5 });

  writeFileSync(
    join(__dirname, 'public', 'whats-new.json'),
    JSON.stringify({ releases }),
  );
} catch (err) {
  // The invariant is "the app must not ship without the asset", so key the
  // failure on that rather than on which phase we think we are in. `next start`
  // re-evaluates this config at runtime, where the build sources are absent but
  // public/whats-new.json already exists from the build stage — that case is
  // fine. Nothing having produced the asset at all is not.
  //
  // Deliberately not keyed on NEXT_PHASE: that is an undocumented Next internal,
  // and if it were ever unset the build would fall through to a warn and ship an
  // image whose "What's new" is empty for every user.
  if (!existsSync(join(__dirname, 'public', 'whats-new.json'))) {
    throw new Error(
      `Failed to generate whats-new.json and no file exists from an earlier ` +
        `build, so the app would ship without it: ${err.message}`,
    );
  }
  console.warn(
    'Could not regenerate public/whats-new.json; using the existing file:',
    err.message,
  );
}

// The newest RELEASE version in the notes, which keys the Help-button "you
// haven't read the latest release notes" sparkle.
//
// Deliberately not NEXT_PUBLIC_APP_VERSION: any deployment that stamps a build
// id into that (a git short SHA, a CI build number) mints a new string on every
// deploy, so the nudge fired for every user on every deploy whether the notes
// had changed or not. This comes from the changelog headings instead, so it moves
// only when a release is published.
//
// Read back from disk rather than off the object written above, so the fallback
// path — regeneration failed and an earlier build's asset is being shipped — is
// keyed to the asset that actually ships.
const whatsNewVersion = JSON.parse(
  readFileSync(join(__dirname, 'public', 'whats-new.json'), 'utf-8'),
).releases[0]?.version;

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
    // Inlined at build time rather than exposed through __ENV.js: builds that
    // omit that script (static exports, embedded builds) still need the sparkle.
    NEXT_PUBLIC_WHATS_NEW_VERSION: whatsNewVersion,
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
