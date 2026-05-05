import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file bundle: every JS/CSS asset gets inlined into mcp-app.html, so
// the MCP server can serve a single self-contained HTML resource without any
// CDN or external requests. This matches the official MCP Apps examples.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: process.env.NODE_ENV !== 'development',
    sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
    rollupOptions: {
      input: 'mcp-app.html',
    },
  },
});
