/**
 * Contract tests for the MCP Apps widget integration.
 *
 * These tests run without ClickHouse and verify that:
 *   1. The widget resource is registered and serves the bundled HTML built
 *      by `packages/mcp-widget` (single-file Vite bundle including React +
 *      `@modelcontextprotocol/ext-apps` + our chart code).
 *   2. The hyperdx_query tool advertises the widget via both `_meta.ui.resourceUri`
 *      and `_meta["ui/resourceUri"]` (slash-key form required by Claude Desktop).
 *   3. The bundled widget HTML contains the protocol handshake (`ui/initialize`)
 *      and our chart-rendering code (line/table/number views).
 *   4. The buildOpenInHyperdxUrl helper produces a /chart deep link.
 *
 * The full query-result -> structuredContent path is exercised by the existing
 * queryTool.test.ts integration test (which requires ClickHouse).
 */
import {
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { buildOpenInHyperdxUrl } from '../tools/query/helpers';
import type { McpContext } from '../tools/types';
import { HYPERDX_WIDGET_URI } from '../ui/widget';
import { createTestClient } from './mcpTestUtils';

describe('MCP Apps widget integration', () => {
  const context: McpContext = {
    teamId: '000000000000000000000001',
    userId: '000000000000000000000002',
  };

  it('registers the ui://hyperdx/widget resource with the built widget bundle', async () => {
    const client = await createTestClient(context);

    const list = await client.listResources();
    const parsed = ListResourcesResultSchema.parse(list);
    const widget = parsed.resources.find(r => r.uri === HYPERDX_WIDGET_URI);
    expect(widget).toBeDefined();
    expect(widget?.mimeType).toBe('text/html;profile=mcp-app');

    const read = await client.readResource({ uri: HYPERDX_WIDGET_URI });
    const parsedRead = ReadResourceResultSchema.parse(read);
    expect(parsedRead.contents).toHaveLength(1);
    const content = parsedRead.contents[0];
    expect(content.uri).toBe(HYPERDX_WIDGET_URI);
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    if (!('text' in content)) {
      throw new Error('Expected text content, got blob');
    }
    expect(typeof content.text).toBe('string');
    // Bundle should be substantial (React + ext-apps SDK + our code).
    // If <50KB it almost certainly means the build is broken or stale.
    expect(content.text.length).toBeGreaterThan(50_000);
    // Spec-compliant App handshake; proves we're using the official SDK,
    // not the ad-hoc postMessage hack.
    expect(content.text).toContain('ui/initialize');
    // Our app identity makes it through the bundle.
    expect(content.text).toContain('HyperDX Chart');

    await client.close();
  });

  it('advertises the widget on hyperdx_query via _meta["ui/resourceUri"] and _meta.ui.resourceUri', async () => {
    const client = await createTestClient(context);

    const list = await client.listTools();
    const parsed = ListToolsResultSchema.parse(list);
    const queryTool = parsed.tools.find(t => t.name === 'hyperdx_query');

    expect(queryTool).toBeDefined();
    const meta = (queryTool as { _meta?: Record<string, unknown> })._meta;
    expect(meta).toBeDefined();

    // Slash-key form: the canonical key the MCP Apps host (e.g. Claude
    // Desktop) reads. Without this, the host shows "Unsupported UI resource
    // content format" instead of rendering the iframe.
    expect(meta?.['ui/resourceUri']).toBe(HYPERDX_WIDGET_URI);

    // Nested form: backward-compatible with hosts that read this shape.
    const ui = meta?.ui as { resourceUri?: string } | undefined;
    expect(ui?.resourceUri).toBe(HYPERDX_WIDGET_URI);

    await client.close();
  });

  it('serves the widget resource with the MCP Apps profile MIME type', async () => {
    const client = await createTestClient(context);

    const list = await client.listResources();
    const parsed = ListResourcesResultSchema.parse(list);
    const widget = parsed.resources.find(r => r.uri === HYPERDX_WIDGET_URI);
    // The mime type MUST include the `;profile=mcp-app` suffix per the
    // ext-apps SDK's RESOURCE_MIME_TYPE constant. Hosts treat plain
    // `text/html` as an unrecognised app and refuse to render it.
    expect(widget?.mimeType).toBe('text/html;profile=mcp-app');

    const read = await client.readResource({ uri: HYPERDX_WIDGET_URI });
    const parsedRead = ReadResourceResultSchema.parse(read);
    expect(parsedRead.contents[0].mimeType).toBe('text/html;profile=mcp-app');

    await client.close();
  });

  it('emits spec-compliant _meta.ui shape on the resource', async () => {
    // Regression guard: Claude Desktop validates the resource _meta against
    // the McpUiResourceMetaSchema and silently refuses to render the widget
    // (showing "Unable to reach hyperdx" + an "Invalid input" warning) if
    // the shape is wrong. Specifically:
    //   - permissions MUST be an object of feature flags, NOT an array.
    //   - csp, if present, uses connectDomains/resourceDomains/etc., NOT
    //     custom keys like frameAncestors.
    const client = await createTestClient(context);
    const list = await client.listResources();
    const parsed = ListResourcesResultSchema.parse(list);
    const widget = parsed.resources.find(r => r.uri === HYPERDX_WIDGET_URI);
    const meta = (widget as { _meta?: Record<string, unknown> })._meta;
    expect(meta).toBeDefined();
    const ui = meta?.ui as Record<string, unknown> | undefined;
    expect(ui).toBeDefined();
    if (ui) {
      // permissions must be an OBJECT (or absent), never an array.
      if (ui.permissions !== undefined) {
        expect(Array.isArray(ui.permissions)).toBe(false);
        expect(typeof ui.permissions).toBe('object');
      }
      // csp must be absent OR an object with only spec-defined keys.
      if (ui.csp !== undefined) {
        expect(typeof ui.csp).toBe('object');
        const csp = ui.csp as Record<string, unknown>;
        for (const k of Object.keys(csp)) {
          expect([
            'connectDomains',
            'resourceDomains',
            'frameDomains',
            'baseUriDomains',
          ]).toContain(k);
        }
      }
    }
    await client.close();
  });

  it('builds a /chart deep link with config + from + to', () => {
    const config: any = {
      name: 'Errors over time',
      displayType: 'line',
      source: 'src_123',
      select: [{ aggFn: 'count' }],
    };
    const url = buildOpenInHyperdxUrl(config, [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T01:00:00Z'),
    ]);
    expect(url).toBeDefined();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe('/chart');
    const cfgParam = parsed.searchParams.get('config');
    expect(cfgParam).toBeTruthy();
    expect(JSON.parse(cfgParam!)).toEqual(config);
    expect(parsed.searchParams.get('from')).toBe(
      String(new Date('2024-01-01T00:00:00Z').getTime()),
    );
    expect(parsed.searchParams.get('to')).toBe(
      String(new Date('2024-01-01T01:00:00Z').getTime()),
    );
  });
});
