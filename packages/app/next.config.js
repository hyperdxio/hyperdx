const { version } = require('./package.json');

const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './src/nextra.config.tsx',
});

module.exports = withNextra({
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
});
