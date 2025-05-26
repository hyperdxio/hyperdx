import type { Options } from 'tsup';

export const tsup: Options = {
  splitting: true,
  clean: true, // clean up the dist folder
  dts: true, // generate dts files
  format: ['cjs', 'esm'], // generate cjs and esm files
  minify: false, // for some reason this introduces a bug in our build
  bundle: true,
  skipNodeModulesBundle: true,
  outDir: 'dist',
  entry: ['src/**/*.ts', '!src/__tests__/**', '!src/**/*.test.*'],
};
