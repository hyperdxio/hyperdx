import {
  BROWSER_EVENT_NAMES,
  getBrowserEventLabel,
} from '@/utils/browserEvents';

const { CLICK, NAVIGATION, CONSOLE, EXCEPTION } = BROWSER_EVENT_NAMES;

describe('getBrowserEventLabel', () => {
  it.each([
    [
      '#root > main.app > section.card.p-4:nth-child(3) > table.w-full > tbody > tr.row.hover\\:bg-gray-50:nth-child(14) > td:nth-child(1) > button.btn.btn-primary',
      'tr:nth-child(14) > td:nth-child(1) > button',
    ],
    [
      '#checkout-form > div.actions > button.btn',
      '#checkout-form > div > button',
    ],
  ])('describes a click on %s by its selector tail', (selector, tail) => {
    expect(
      getBrowserEventLabel({
        eventName: CLICK,
        body: '',
        attributes: {
          'browser.tag_name': 'BUTTON',
          'browser.css_selector': selector,
        },
      }),
    ).toEqual({
      title: 'Clicked button',
      description: tail,
      timelineText: `Clicked ${tail}`,
      isError: false,
      eventSource: 'custom',
    });
  });

  it.each([
    [
      'flat keys',
      {
        'browser.element.attributes.action': 'buy',
        'browser.element.attributes.sku': '42',
      },
    ],
    [
      'a JSON string',
      { 'browser.element.attributes': '{"action":"buy","sku":"42"}' },
    ],
    [
      'a JSON column',
      { browser: { element: { attributes: { action: 'buy', sku: 42 } } } },
    ],
  ])(
    'describes a click by data-otel attributes as %s',
    (_shape, attributes) => {
      expect(
        getBrowserEventLabel({
          eventName: CLICK,
          body: '',
          attributes: {
            'browser.css_selector': '#root > button.buy',
            ...attributes,
          },
        }).description,
      ).toBe('action=buy sku=42');
    },
  );

  it('describes a navigation by its short URL', () => {
    expect(
      getBrowserEventLabel({
        eventName: NAVIGATION,
        body: '',
        attributes: {
          'url.full': 'http://localhost:5173/cart/checkout?step=2',
          'browser.document.url.full': 'http://localhost:5173/',
        },
      }),
    ).toMatchObject({
      title: 'Navigated',
      description: '/cart/checkout',
      timelineText: 'Navigated to /cart/checkout',
      eventSource: 'navigation',
    });
  });

  it.each([
    ['error', true],
    ['log', false],
  ])('labels console.%s by its first line', (method, isError) => {
    expect(
      getBrowserEventLabel({
        eventName: CONSOLE,
        body: 'Error: boom\n    at onClick (app.js:1:1)',
        attributes: { 'browser.console.method': method },
      }),
    ).toMatchObject({
      title: `console.${method}`,
      description: 'Error: boom',
      timelineText: `console.${method}: Error: boom`,
      isError,
    });
  });

  it.each([
    [
      '',
      { 'exception.type': 'TypeError', 'exception.message': 'x is undefined' },
      ['TypeError', 'x is undefined', 'TypeError: x is undefined'],
    ],
    [
      'Error: Checkout failed\n    at submit (app.js:2:2)',
      {},
      ['Error', 'Error: Checkout failed', 'Error: Checkout failed'],
    ],
  ])(
    'labels an exception with body %p and %p as an error',
    (body, attributes, [title, description, timelineText]) => {
      expect(
        getBrowserEventLabel({ eventName: EXCEPTION, body, attributes }),
      ).toMatchObject({ title, description, timelineText, isError: true });
    },
  );
});
