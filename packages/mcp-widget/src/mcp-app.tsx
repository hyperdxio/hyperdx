/**
 * HyperDX MCP App widget.
 *
 * Renders observability query results returned by the `hyperdx_query` tool.
 * Display types supported: line, stacked_bar, table, search, number, pie.
 * (search renders through the table view; same row/column shape, no
 *  per-row detail panel yet.)
 *
 * Protocol contract (from `packages/api/src/mcp/tools/query/helpers.ts`):
 *   structuredContent = {
 *     displayType: 'line' | 'stacked_bar' | 'table' | 'number' | ...,
 *     config:      <SavedChartConfig>,
 *     data:        <ResponseJSON>  -> { meta: [{name, type}], data: [{...}], rows },
 *     links: { openInHyperdxUrl: string },
 *   }
 */
import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import {
  LineChartView,
  NumberView,
  PieView,
  TableView,
  type StructuredContent,
} from './views';

const APP_INFO = { name: 'HyperDX Chart', version: '0.1.0' };

function HyperDXApp() {
  const [structured, setStructured] = useState<StructuredContent | null>(null);
  const [hostContext, setHostContext] = useState<
    McpUiHostContext | undefined
  >();

  const { app, error } = useApp({
    appInfo: APP_INFO,
    capabilities: {},
    onAppCreated: created => {
      // Tool result is the ONLY way data reaches the widget; the host
      // pushes it after the LLM's tools/call returns. We extract the
      // server's structuredContent and render from it.
      created.ontoolresult = result => {
        const sc = (result as CallToolResult & { structuredContent?: unknown })
          .structuredContent as StructuredContent | undefined;
        if (sc) setStructured(sc);
      };
      created.onhostcontextchanged = ctx => {
        setHostContext(prev => ({ ...prev, ...ctx }));
      };
      created.onerror = err => {
        // eslint-disable-next-line no-console
        console.error('[hyperdx-widget] app error', err);
      };
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) {
    return (
      <div className="error">
        <strong>Widget error:</strong> {error.message}
      </div>
    );
  }
  if (!app) {
    return <div className="loading">Connecting…</div>;
  }
  if (!structured) {
    return <div className="loading">Waiting for query result…</div>;
  }

  return (
    <Inner app={app} structured={structured} hostContext={hostContext} />
  );
}

function Inner({
  app,
  structured,
  hostContext,
}: {
  app: App;
  structured: StructuredContent;
  hostContext?: McpUiHostContext;
}) {
  const handleOpenInHyperdx = useCallback(async () => {
    const url = structured.links?.openInHyperdxUrl;
    if (!url) return;
    try {
      await app.openLink({ url });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[hyperdx-widget] openLink failed', e);
    }
  }, [app, structured.links?.openInHyperdxUrl]);

  return (
    <main
      className="root"
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <header>
        <div>
          <h1>{structured.config?.name ?? 'HyperDX'}</h1>
          <Subtitle structured={structured} />
        </div>
        <button
          type="button"
          onClick={handleOpenInHyperdx}
          disabled={!structured.links?.openInHyperdxUrl}
          title="Open this chart in HyperDX with the same query"
        >
          Open in HyperDX
        </button>
      </header>
      <View structured={structured} />
    </main>
  );
}

function Subtitle({ structured }: { structured: StructuredContent }) {
  const rows = structured.data?.data?.length ?? 0;
  return (
    <div className="meta">
      {rows} row{rows === 1 ? '' : 's'} · {structured.displayType}
    </div>
  );
}

function View({ structured }: { structured: StructuredContent }) {
  const dt = structured.displayType;
  if (dt === 'line' || dt === 'stacked_bar') {
    return <LineChartView structured={structured} />;
  }
  // search returns rows + columns just like a table; render through the
  // same view. (The dashboard's search experience adds a side-panel detail
  // view that we don't replicate here yet.)
  if (dt === 'table' || dt === 'search') {
    return <TableView structured={structured} />;
  }
  if (dt === 'number') return <NumberView structured={structured} />;
  if (dt === 'pie') return <PieView structured={structured} />;
  return (
    <div className="empty">Unsupported displayType: {String(dt)}</div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <HyperDXApp />
    </StrictMode>,
  );
}
