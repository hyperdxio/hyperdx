import React from 'react';
/* Polyfills for browser APIs in Node.js test environment */
import { TextDecoder, TextEncoder } from 'util';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { render } from '@testing-library/react';
import structuredClone from '@ungap/structured-clone';

import '@testing-library/jest-dom';
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

/* Mocks for mantine */
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;
// jsdom has no scrollIntoView, and Mantine's Combobox calls it on the active
// option when a dropdown opens — from a setTimeout, so the resulting TypeError
// surfaces as an unrelated async test failure.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
Object.defineProperty(window, 'matchMedia', {
  value: () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

global.renderWithMantine = (ui: React.ReactElement) => {
  return render(
    <MantineProvider>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
};

if (!globalThis.structuredClone) {
  // @ts-expect-error this is a correct polyfill
  globalThis.structuredClone = structuredClone;
}

declare global {
  function renderWithMantine(ui: React.ReactElement): ReturnType<typeof render>;
}
