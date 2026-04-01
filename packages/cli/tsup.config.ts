import type { Options } from 'tsup';

export const tsup: Options = {
  splitting: false,
  clean: true,
  format: ['esm'],
  bundle: true,
  skipNodeModulesBundle: true,
  outDir: 'dist',
  entry: ['src/cli.tsx'],
};
