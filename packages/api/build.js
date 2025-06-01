const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
  try {
    // Make sure dist directory exists
    const distDir = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }

    // Build main application
    await esbuild.build({
      entryPoints: ['src/index.ts', 'src/tasks/index.ts'],
      bundle: true,
      platform: 'node',
      target: 'node22',
      outdir: 'dist',
      sourcemap: false,
      minify: true,
      format: 'cjs',
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      banner: {
        js: '#!/usr/bin/env node',
      },
      alias: {
        // Add path aliases from tsconfig
        '@': path.resolve(__dirname, 'src'),
      },
    });

    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
