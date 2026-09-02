import { parseSourcePageBaggage } from '@/utils/baggage';

describe('parseSourcePageBaggage', () => {
  it('promotes known members to span attributes', () => {
    expect(
      parseSourcePageBaggage(
        'hyperdx.source_page=%2Fdashboards%2Fabc,hyperdx.source_mode=kiosk%2CisLive',
      ),
    ).toEqual({
      'hyperdx.query.source_page': '/dashboards/abc',
      'hyperdx.query.source_mode': 'kiosk,isLive',
    });
  });

  it.each([undefined, '', 'malformed', '=novalue'])(
    'returns nothing for %p',
    header => {
      expect(parseSourcePageBaggage(header)).toEqual({});
    },
  );

  // Baggage is client-supplied, so an unknown key must not become an attribute.
  it('ignores members outside the allowlist', () => {
    expect(
      parseSourcePageBaggage(
        'attacker.key=value,hyperdx.source_page=%2Fsearch',
      ),
    ).toEqual({ 'hyperdx.query.source_page': '/search' });
  });

  it('strips the properties a baggage member may carry', () => {
    expect(
      parseSourcePageBaggage('hyperdx.source_page=%2Fsearch;metadata=extra'),
    ).toEqual({ 'hyperdx.query.source_page': '/search' });
  });

  it('keeps valid members when another is badly encoded', () => {
    expect(
      parseSourcePageBaggage(
        'hyperdx.source_mode=%E0%A4%A,hyperdx.source_page=%2Fsearch',
      ),
    ).toEqual({ 'hyperdx.query.source_page': '/search' });
  });

  it('accepts a repeated header split by the http layer', () => {
    expect(
      parseSourcePageBaggage(['other=1', 'hyperdx.source_page=%2Fsearch']),
    ).toEqual({ 'hyperdx.query.source_page': '/search' });
  });
});
