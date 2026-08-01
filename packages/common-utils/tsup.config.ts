import type { Options } from 'tsup';

export const tsup: Options = {
  splitting: true,
  clean: true, // clean up the dist folder
  dts: {
    // tsup's DTS bundler (rollup-plugin-dts) unconditionally injects the
    // `baseUrl` compiler option, which TypeScript 6 reports as deprecated
    // (TS5101). Acknowledge the deprecation so DTS generation succeeds until
    // tsup stops forcing baseUrl.
    compilerOptions: {
      ignoreDeprecations: '6.0',
    },
  }, // generate dts files
  format: ['cjs', 'esm'], // generate cjs and esm files
  minify: true,
  bundle: true,
  skipNodeModulesBundle: true,
  outDir: 'dist',
  entry: ['src/**/*.ts', '!src/__tests__/**', '!src/**/*.test.*'],
};
