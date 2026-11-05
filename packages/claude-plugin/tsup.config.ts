import { fileURLToPath } from 'node:url';
import { defineConfig, type Options } from 'tsup';

type Plugin = NonNullable<Options['esbuildPlugins']>[number];

const chalkShim = fileURLToPath(new URL('./src/chalk.ts', import.meta.url));
const commonUtilsSrc = fileURLToPath(
  new URL('../common-utils/src/', import.meta.url),
);

// Claude Code refuses a hooks module over 1 MiB. common-utils' CommonJS dist
// can't be tree-shaken (node-sql-parser alone is 2.4 MB), so bundle its ESM
// source and treat dependencies as side-effect free to drop what the chart
// path never calls.
const shrink: Plugin = {
  name: 'shrink',
  setup(build) {
    build.onResolve({ filter: /^chalk$/ }, args =>
      args.importer === chalkShim || args.pluginData
        ? undefined
        : { path: chalkShim },
    );
    build.onResolve(
      { filter: /^@hyperdx\/common-utils\/dist\// },
      async args => {
        const src = args.path.replace(
          /^@hyperdx\/common-utils\/dist\//,
          commonUtilsSrc,
        );
        const resolved = await build.resolve(src, {
          kind: args.kind,
          resolveDir: args.resolveDir,
        });
        return { path: resolved.path, sideEffects: false };
      },
    );
    build.onResolve({ filter: /^[^./]/ }, async args => {
      if (args.pluginData) return undefined;
      const resolved = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        pluginData: true,
      });
      return resolved.errors.length
        ? undefined
        : { ...resolved, sideEffects: false };
    });
  },
};

// hooks/register.tsx is compiled by Claude Code itself and must stay readable to
// `claude plugin validate`; the renderer it imports is bundled here for an
// environment with no Node and no DOM.
export default defineConfig({
  entry: { chart: 'src/index.ts' },
  outDir: 'hooks',
  format: ['esm'],
  platform: 'browser',
  bundle: true,
  splitting: false,
  clean: false,
  noExternal: [/.*/],
  define: { 'process.env.NODE_ENV': '"production"' },
  // Each package's source resolves its own `@/` alias, so esbuild must use the
  // nearest tsconfig per file rather than this package's.
  esbuildOptions(options) {
    delete options.tsconfig;
  },
  esbuildPlugins: [shrink],
});
