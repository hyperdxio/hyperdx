export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@hyperdx/node-opentelemetry');
    init({
      apiKey: process.env.HYPERDX_API_KEY,
      additionalInstrumentations: [], // optional, default: []
    });
  }
}
