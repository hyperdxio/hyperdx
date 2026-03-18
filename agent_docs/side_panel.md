# Side Panel Architecture & Metadata Patterns

## Overview

The row side panel (`DBRowSidePanel`) is the primary detail view for
inspecting individual telemetry events (logs, traces, spans). It opens as a
right-side drawer and adapts its layout based on the source type.

## Panel Variants

### Trace Source Panel (full-width, `100vw`)

Opens when clicking a trace/span row. Uses the full viewport width to
accommodate the waterfall chart + span details split layout.

### Log/Event Panel (fixed-width, `600px`, resizable)

Opens when clicking a log or other non-trace row. Fixed narrow width with
drag-to-resize. No background overlay.

## Header Pattern (Consistent Across Variants)

Both panel variants follow the same two-row header structure in
`DBRowSidePanel.tsx`:

### Row 1: Title Bar

```
[← Close] {Title}                    [Share] [← Prev] [Next →]
```

- **Close button**: `ActionIcon` with `variant="secondary"`, `IconArrowLeft`
- **Title**: `Text size="sm" fw={600} truncate="end"`
  - Trace: `"Trace: {spanName}"`
  - Log: `{severityText} · {body}`
- **Actions (right side)**: `SidePanelHeaderActions` component, always shown
  - Share: copies current URL to clipboard via `CopyButton`
  - Prev/Next: dispatches keyboard events to trigger row navigation in `DBRowTable`

### Row 2: Inline Metadata

```
Timestamp · ago  ·  Service {name}  ·  Duration {value}  ·  Status {value}  [Badge]
```

Metadata items use a consistent pattern:

```tsx
<Group gap={4}>
  <Text size="xs" c="dimmed">{label}</Text>
  <Text size="xs" fw={500}>{value}</Text>
</Group>
```

Items are separated by `·` (middle dot) via `<Text size="xs" c="dimmed">·</Text>`.

### Metadata Fields by Source Type

| Field       | Trace | Log |
|-------------|-------|-----|
| Timestamp   | Yes   | Yes |
| Service     | Yes   | Yes (if available) |
| Duration    | Yes   | No  |
| Status      | Yes   | No  |
| Span Kind   | Yes (Badge) | No |
| Severity    | No    | Yes (in title via `LogLevel`) |
| Highlighted Attributes | No | Yes (`DBHighlightedAttributesList`) |

## Trace Navigation from Logs

When a log has an associated `traceId` and `traceSourceId`, the metadata row
shows a "View Trace →" link (`Text` with `c="blue.4"`). Clicking it opens a
**separate full-width Drawer** on top of the log panel containing
`DBTracePanel`. The log panel remains underneath at its original width.

The trace drawer has its own back button labeled "Back to log" that closes it
and returns to the log panel. This avoids the jarring UX of dynamically
resizing the log drawer.

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| `DBRowSidePanelErrorBoundary` | `DBRowSidePanel.tsx` | Outer wrapper: Drawer, resize handle, error boundary |
| `DBRowSidePanel` | `DBRowSidePanel.tsx` | Inner content: header, tabs, tab panels |
| `DBRowSidePanelHeader` | `DBRowSidePanelHeader.tsx` | Legacy header (used by `DBRowOverviewPanel` when `hideHeader=false`) |
| `DBTracePanel` | `DBTracePanel.tsx` | Trace tab: waterfall chart + span details split |
| `LogLevel` | `LogLevel.tsx` | Severity text with color coding |
| `DBHighlightedAttributesList` | `DBHighlightedAttributesList.tsx` | Inline attribute tags for logs |

## Data Sources for Metadata

Metadata values come from `useRowData` hook via `ROW_DATA_ALIASES`:

- `__hdx_body` → main content / title text
- `__hdx_severity_text` → log severity level
- `__hdx_timestamp` → event timestamp
- `__hdx_trace_id` → trace correlation
- `__hdx_span_id` → span identification
- `ROW_DATA_ALIASES.DURATION_MS` → span duration (trace sources)
- `ROW_DATA_ALIASES.SPAN_KIND` → span kind enum (trace sources)
- `ROW_DATA_ALIASES.SERVICE_NAME` → service name

## Tab Structure

### Trace Sources

Top-level: **Trace** | Service Map | Surrounding Context | Session Replay

The Trace tab uses a horizontal split: waterfall chart (left) + span details
(right). Span details has sub-tabs: Overview | Column Values | Infrastructure.

### Log/Event Sources

Top-level: **Overview** | Column Values | Surrounding Context | Session Replay

No Trace tab — trace navigation is via the "View Trace" button in the header.
