import { buildSourcePageBaggage } from '@/clickhouse/browser';

describe('buildSourcePageBaggage', () => {
  it('records the originating page', () => {
    expect(
      buildSourcePageBaggage({ pathname: '/search', search: '?from=1&to=2' }),
    ).toBe('hyperdx.source_page=%2Fsearch');
  });

  it('records auto-refreshing modes', () => {
    expect(
      buildSourcePageBaggage({
        pathname: '/dashboards/abc',
        search: '?kiosk=true&isLive=true',
      }),
    ).toBe(
      'hyperdx.source_page=%2Fdashboards%2Fabc,hyperdx.source_mode=kiosk%2CisLive',
    );
  });

  // The params are tri-state in the URL (absent / false / true); only `true`
  // means the view is refreshing on its own.
  it('omits the mode member when the params are absent or false', () => {
    expect(
      buildSourcePageBaggage({
        pathname: '/search',
        search: '?isLive=false&kiosk=false',
      }),
    ).toBe('hyperdx.source_page=%2Fsearch');
  });

  // Baggage is comma-delimited, so an unencoded comma in a value would be read
  // as a second member by the receiver.
  it('encodes the comma separating multiple modes', () => {
    const baggage = buildSourcePageBaggage({
      pathname: '/dashboards/abc',
      search: '?kiosk=true&isLive=true',
    });

    expect(baggage.split(',')).toHaveLength(2);
  });

  it('carries no query string into the baggage', () => {
    const baggage = buildSourcePageBaggage({
      pathname: '/search',
      search: '?q=password%3Dhunter2&isLive=true',
    });

    expect(baggage).not.toContain('hunter2');
  });
});
