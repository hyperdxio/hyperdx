import { deriveAlertNameAndTags } from '@/migrations';
import { AlertSource } from '@/models/alert';

describe('deriveAlertNameAndTags', () => {
  const savedSearch = { name: 'Error spikes', tags: ['errors', 'prod'] };
  const dashboard = {
    name: 'Service health',
    tags: ['infra'],
    tiles: [{ id: 'tile-1', config: { name: 'P95 latency' } }],
  };

  it('uses the saved search name and tags for saved-search alerts', () => {
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.SAVED_SEARCH },
        savedSearch,
        undefined,
      ),
    ).toEqual({ name: 'Error spikes', tags: ['errors', 'prod'] });
  });

  it('treats a missing source as a saved-search alert', () => {
    expect(deriveAlertNameAndTags({}, savedSearch, undefined)).toEqual({
      name: 'Error spikes',
      tags: ['errors', 'prod'],
    });
  });

  it('joins dashboard and tile names for tile alerts', () => {
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.TILE, tileId: 'tile-1' },
        undefined,
        dashboard,
      ),
    ).toEqual({ name: 'Service health P95 latency', tags: ['infra'] });
  });

  it('falls back to "Tile" when the tile is missing or unnamed', () => {
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.TILE, tileId: 'gone' },
        undefined,
        dashboard,
      ).name,
    ).toBe('Service health Tile');
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.TILE, tileId: 'tile-1' },
        undefined,
        { name: 'Dash', tiles: [{ id: 'tile-1', config: {} }] },
      ).name,
    ).toBe('Dash Tile');
  });

  it('uses the chart config name for inline alerts', () => {
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.INLINE, chartConfig: { name: 'CPU usage' } },
        undefined,
        undefined,
      ),
    ).toEqual({ name: 'CPU usage', tags: [] });
  });

  it('returns a null name for dangling references', () => {
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.SAVED_SEARCH },
        undefined,
        undefined,
      ),
    ).toEqual({ name: null, tags: [] });
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.TILE, tileId: 'tile-1' },
        undefined,
        undefined,
      ),
    ).toEqual({ name: null, tags: [] });
  });

  it('normalizes malformed values', () => {
    expect(
      deriveAlertNameAndTags(
        { source: AlertSource.SAVED_SEARCH },
        { name: '   ', tags: ['ok', 7, '', null] },
        undefined,
      ),
    ).toEqual({ name: null, tags: ['ok'] });
  });

  it('trims and truncates names to 512 characters', () => {
    const result = deriveAlertNameAndTags(
      { source: AlertSource.SAVED_SEARCH },
      { name: `  ${'x'.repeat(600)}  ` },
      undefined,
    );
    expect(result.name).toBe('x'.repeat(512));
  });
});
