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
  // NOTE (Berg / Task 4): the runtime ClickHouse client has been replaced
  // by `src/athena/` (AthenaClient).  `src/clickhouse.ts` remains as a
  // transitional shim for the SQL builder helpers (chSql, JSDataType, etc.)
  // that Tasks 5/6/9/11 will port to Trino — once those tasks finish,
  // delete the shim and this comment.
  entry: ['src/**/*.ts', '!src/__tests__/**', '!src/**/*.test.*'],
};
