import type { Options } from 'tsup';

export const tsup: Options = {
  splitting: true,
  clean: true, // clean up the dist folder
  dts: false, // dts handled by separate `tsc --emitDeclarationOnly` step
  format: ['cjs', 'esm'], // generate cjs and esm files
  minify: true,
  bundle: true,
  skipNodeModulesBundle: true,
  outDir: 'dist',
  // NOTE (Berg / Task 2): the runtime ClickHouse client packages
  // (@clickhouse/client and @clickhouse/client-web) have been removed.  The
  // clickhouse/ entry points are excluded so the rest of common-utils can
  // emit JS for downstream packages while Task 4 swaps in the Athena client.
  entry: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/**/*.test.*',
    '!src/clickhouse/**',
  ],
};
