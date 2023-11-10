# Remix

HyperDX comes with simple to use out-of-the box Remix support via our [browser SDK](https://www.hyperdx.io/docs/install/browser). The [browser SDK](https://www.hyperdx.io/docs/install/browser) allows you to intrument your frontend application to send events, route logs, and session data to HyperDX. We also have multiple backend integrations depending on your Remix Stack, for example when using [Node.js](https://www.hyperdx.io/docs/install/javascript) servers like Express, Vercel, Netlify, Architect, etc.

## Getting Started

### Install

```bash
npm install @hyperdx/browser
```

### Initialize HyperDX in root.tsx file

```js
import HyperDX from '@hyperdx/browser';

HyperDX.init({
  apiKey: '<YOUR_API_KEY_HERE>',
  service: 'my-frontend-app',
  tracePropagationTargets: [/api.myapp.domain/i], // Set to link traces from frontend to backend requests
  consoleCapture: true, // Capture console logs (default false)
  advancedNetworkCapture: true, // Capture full HTTP request/response headers and bodies (default false)
});
```

## (Optional) Use [opentelemetry-instrumentation-remix](https://github.com/justindsmith/opentelemetry-instrumentations-js/tree/main/packages/instrumentation-remix) package for Node.js servers.

### Install

```bash
npm install opentelemetry-instrumentation-remix
```

#### Create instrument.js file in application folder

```js
const { initSDK } = require('@hyperdx/node-opentelemetry');
const { RemixInstrumentation } = require('opentelemetry-instrumentation-remix');


initSDK({
    consoleCapture: true, // optional, default: true
    advancedNetworkCapture: true, // optional, default: false
    additionalInstrumentations: [new RemixInstrumentation()]
});
```

### Run the Application with HyperDX 

#### Using NPX

```bash
HYPERDX_API_KEY='<YOUR_HYPERDX_API_KEY>' OTEL_SERVICE_NAME='<YOUR_APP_NAME>' NODE_OPTIONS='-r <REALATIVE_TRACKING.JS_PATH>' remix dev
```



