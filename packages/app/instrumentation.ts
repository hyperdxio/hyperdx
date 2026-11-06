// This file sits next to pages/ because next build looks for it only there,
// not in src/. The Dockerfiles copy it (and instrumentation-client.ts) by name.
export async function register() {
  // The edge build drops this branch, so it never bundles the Node.js SDK
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNextServerTelemetry } = await import(
      '@/utils/nextServerTelemetry'
    );
    await startNextServerTelemetry();
  }
}
