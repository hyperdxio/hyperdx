# Remix

HyperDX comes with simple to use out-of-the box Remix support via out browser SDK. The browser SDK allows you to intrument your frontend application to send events, route logs, and session data to HyperDX. We also have multiple backend integrations depending on your Remix Stack, for example when using [Node.js](https://www.hyperdx.io/docs/install/javascript) servers like Express, Vercel, Netlify, Architect, etc.

## Getting Started

### Install

```bash
npm install @hyperdx/browser
```

### Initialize HyperDX

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

### (Optional) Attach User Information or Metadata

Attaching user information will allow you to search/filter sessions and events in HyperDX. This can be called at any point during the client session. The current client session and all events sent after the call will be associated with the user information.

`userEmail`, `userName`, and `teamName` will populate the sessions UI with the corresponding values, but can be omitted. Any other additional values can be specified and used to search for events.

```js
HyperDX.setGlobalAttributes({
  userEmail: user.email,
  userName: user.name,
  teamName: user.team.name,
  // Other custom properties...
});
```

### (Optional) Send Custom Actions

To explicitly track a specific application event (ex. sign up, submission, etc.), you can call the `addAction` function with an event name and optional event metadata.

Example:

```js
HyperDX.addAction('Form-Completed', {
  formId: 'signup-form',
  formName: 'Signup Form',
  formType: 'signup',
});
```

### (Optional) Route Tracking

To explicitly track a routes we recommend using custom actions per routes.

Example:

```js
HyperDX.addAction('/form-page', {
  endpoint: 'form-page'
});
```

### (Optional) Enable Network Capture Dynamically

To enable or disable network capture dynamically, simply invoke the `enableAdvancedNetworkCapture` or `disableAdvancedNetworkCapture` function as needed.

```js
HyperDX.enableAdvancedNetworkCapture();
```
