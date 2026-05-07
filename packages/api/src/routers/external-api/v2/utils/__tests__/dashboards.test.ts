import { isBuilderSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  DisplayType,
  validateDashboardContainersConsistency,
} from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

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
      // The internal Tile shape carries name on config, not at the top
      // level. The previous `pick(...)` swept name onto the top-level
      // object (a stale extra field that the renderer never reads); the
      // destructure refactor fixes that.
      expect(result.config.name).toBe('How to Use');
      expect(result).not.toHaveProperty('name');
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

describe('validateDashboardContainersConsistency', () => {
  // Drives the helper through z.superRefine and inspects the resulting
  // ZodError so we can assert path + message without standing up the full
  // express + DB stack.
  function runHelper<T extends { containerId?: string; tabId?: string }>(
    containers: Parameters<typeof validateDashboardContainersConsistency>[0],
    tiles: T[],
  ): z.ZodIssue[] {
    const schema = z
      .object({
        containers: z.array(z.unknown()).optional() as unknown as z.ZodTypeAny,
        tiles: z.array(z.unknown()) as unknown as z.ZodTypeAny,
      })
      .superRefine((data, ctx) => {
        validateDashboardContainersConsistency(
          (data.containers ?? []) as typeof containers,
          (data.tiles ?? []) as T[],
          ctx,
        );
      });
    const result = schema.safeParse({ containers, tiles });
    return result.success ? [] : result.error.issues;
  }

  it('raises no issues for empty inputs', () => {
    expect(runHelper([], [])).toEqual([]);
  });

  it('raises no issues for valid containers and tile refs', () => {
    expect(
      runHelper(
        [
          {
            id: 'a',
            title: 'A',
            collapsed: false,
            tabs: [{ id: 't1', title: 'T1' }],
          },
        ],
        [{ containerId: 'a', tabId: 't1' }],
      ),
    ).toEqual([]);
  });

  it('flags duplicate container ids and stops tile resolution', () => {
    const issues = runHelper(
      [
        { id: 'a', title: 'A', collapsed: false },
        { id: 'a', title: 'B', collapsed: false },
      ],
      // Tile would otherwise raise an unknown-containerId error too;
      // verifying the helper short-circuits keeps that error from
      // stacking on top of the duplicate-id error.
      [{ containerId: 'ghost' }],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['containers', 1, 'id']);
    expect(issues[0].message).toContain('Container IDs must be unique');
  });

  it('flags duplicate tab ids inside a container', () => {
    const issues = runHelper(
      [
        {
          id: 'a',
          title: 'A',
          collapsed: false,
          tabs: [
            { id: 't1', title: 'T1' },
            { id: 't1', title: 'T1 again' },
          ],
        },
      ],
      [],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['containers', 0, 'tabs', 1, 'id']);
    expect(issues[0].message).toContain('Duplicate tab id');
  });

  it('flags an unknown containerId on a tile', () => {
    const issues = runHelper(
      [{ id: 'a', title: 'A', collapsed: false }],
      [{ containerId: 'b' }],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['tiles', 0, 'containerId']);
    expect(issues[0].message).toContain('unknown containerId');
  });

  it('flags a tabId without containerId', () => {
    const issues = runHelper([], [{ tabId: 't1' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['tiles', 0, 'tabId']);
    expect(issues[0].message).toContain('tabId requires containerId');
  });

  it('flags an unknown tabId on a tile', () => {
    const issues = runHelper(
      [
        {
          id: 'a',
          title: 'A',
          collapsed: false,
          tabs: [{ id: 't1', title: 'T1' }],
        },
      ],
      [{ containerId: 'a', tabId: 'ghost' }],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['tiles', 0, 'tabId']);
    expect(issues[0].message).toContain('unknown tabId');
  });
});
