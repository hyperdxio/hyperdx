import { isBuilderSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { ConfigTile, convertToInternalTileConfig } from '../dashboards';

function makeMarkdownTile(
  markdown?: string,
  overrides: Partial<ConfigTile> = {},
): ConfigTile {
  return {
    id: 'test-id',
    x: 0,
    y: 0,
    w: 12,
    h: 4,
    name: 'Text Tile',
    config: { displayType: 'markdown', markdown },
    ...overrides,
  };
}

describe('convertToInternalTileConfig', () => {
  describe('markdown tiles', () => {
    it('sets displayType to Markdown', () => {
      const result = convertToInternalTileConfig(makeMarkdownTile('# Hello'));
      expect(result.config).toMatchObject({
        displayType: DisplayType.Markdown,
      });
    });

    it('preserves markdown content', () => {
      const content = '## Guide\n\nSome instructions here.';
      const result = convertToInternalTileConfig(makeMarkdownTile(content));
      if (!isBuilderSavedChartConfig(result.config)) {
        throw new Error('Expected BuilderSavedChartConfig for markdown tile');
      }
      expect(result.config.markdown).toBe(content);
    });

    it('handles missing markdown content', () => {
      const result = convertToInternalTileConfig(makeMarkdownTile(undefined));
      expect(result.config).toMatchObject({
        displayType: DisplayType.Markdown,
      });
    });

    it('preserves tile layout fields', () => {
      const tile = makeMarkdownTile('Some text', {
        x: 4,
        y: 8,
        w: 24,
        h: 3,
        name: 'How to Use',
      });
      const result = convertToInternalTileConfig(tile);
      expect(result.x).toBe(4);
      expect(result.y).toBe(8);
      expect(result.w).toBe(24);
      expect(result.h).toBe(3);
      // name is picked by convertToInternalTileConfig but not part of the
      // Tile type — verify it round-trips via the runtime object.
      expect(result).toHaveProperty('name', 'How to Use');
    });

    it('does not set a real sourceId on the internal config', () => {
      // Markdown tiles have source: '' in the internal format to satisfy the
      // BuilderSavedChartConfig type. The frontend uses displayTypeRequiresSource()
      // to exclude markdown tiles from "source unset" checks.
      // See DBDashboardPage isSourceUnset and common-utils/src/guards.ts.
      const result = convertToInternalTileConfig(makeMarkdownTile('# Hello'));
      if (!isBuilderSavedChartConfig(result.config)) {
        throw new Error('Expected BuilderSavedChartConfig for markdown tile');
      }
      expect(result.config.source).not.toMatch(/^[a-f0-9]{24}$/); // not a real ObjectId
    });
  });
});
