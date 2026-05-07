import React from 'react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
/* Polyfills for browser APIs in Node.js test environment */
import { TextDecoder, TextEncoder } from 'util';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { render } from '@testing-library/react';
import structuredClone from '@ungap/structured-clone';

import enCommon from '../public/locales/en/common.json';

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
Object.defineProperty(window, 'matchMedia', {
  value: () => ({
    matches: false,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

const testI18n = i18next.createInstance();
void testI18n.use(initReactI18next).init({
  defaultNS: 'common',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  lng: 'en',
  ns: ['common'],
  resources: {
    en: {
      common: enCommon,
    },
  },
});

global.renderWithMantine = (ui: React.ReactElement) => {
  return render(
    <I18nextProvider i18n={testI18n}>
      <MantineProvider>
        <Notifications />
        {ui}
      </MantineProvider>
    </I18nextProvider>,
  );
};

if (!globalThis.structuredClone) {
  // @ts-expect-error this is a correct polyfill
  globalThis.structuredClone = structuredClone;
}

declare global {
  function renderWithMantine(ui: React.ReactElement): ReturnType<typeof render>;
}
