import type { Options } from 'tsup';

export const tsup: Options = {
  splitting: true,
  clean: true, // clean up the dist folder
  // Declarations come from (the more efficient) tsc
  dts: false,
  format: ['cjs', 'esm'], // generate cjs and esm files
  minify: true,
  bundle: true,
  skipNodeModulesBundle: true,
  outDir: 'dist',
  entry: ['src/**/*.ts', '!src/__tests__/**', '!src/**/*.test.*'],
};
