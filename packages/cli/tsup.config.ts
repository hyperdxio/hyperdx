import { defineConfig } from 'tsup';
import module from 'node:module';

export default defineConfig({
  splitting: false,
  clean: true,
  format: ['esm'],
  platform: 'node',
  bundle: true,
  outDir: 'dist',
  entry: ['src/cli.tsx'],
  // Bundle all dependencies into a single file for distribution.
  noExternal: [/.*/],
  // Keep Node.js built-ins + optional deps external
  external: [
    ...module.builtinModules,
    ...module.builtinModules.map(m => `node:${m}`),
    'react-devtools-core',
  ],
  // Inject createRequire shim so CJS deps (signal-exit, etc.) can use
  // require() for Node.js built-ins inside the ESM bundle.
  banner: {
    js: [
      'import { createRequire as __cr } from "module";',
      'const require = __cr(import.meta.url);',
    ].join('\n'),
  },
});
