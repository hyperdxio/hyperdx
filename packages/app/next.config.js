const { configureRuntimeEnv } = require('next-runtime-env/build/configure');
const { version } = require('./package.json');

configureRuntimeEnv();

const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './src/nextra.config.tsx',
});

module.exports = {
  experimental: {
    instrumentationHook: true,
  },
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
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_SERVER_URL}/:path*`,
      },
    ];
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
    // This slows down builds by 2x for some reason...
    swcMinify: false,
    publicRuntimeConfig: {
      version,
    },
    productionBrowserSourceMaps: false,
    ...(process.env.NEXT_OUTPUT_STANDALONE === 'true'
      ? {
          output: 'standalone',
        }
      : {}),
  }),
};
