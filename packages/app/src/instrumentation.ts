export async function register() {
  // The SDK starts even without a key and defaults to localhost:4318, so gate
  // it on the key as @hyperdx/node-opentelemetry did.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.HYPERDX_API_KEY) {
    const { init } = await import('@clickhouse/clickstack-node');
    init({ apiKey: process.env.HYPERDX_API_KEY });
  }
}
