import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  external: ['react', 'react-dom', 'recharts'],
  target: 'es2022',
});
