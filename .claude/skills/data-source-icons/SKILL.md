---
name: data-source-icons
description: Use the correct Tabler icon for each HyperDX data source kind (Log, Trace, Session, Metric, PromQL). Use whenever adding or changing an icon that represents a source kind or a signal type — source selectors, side panels, cross-source actions like "View Trace", tabs, badges, breadcrumbs, or anywhere a log/trace/session/metric is depicted.
---

# Data source icons

There is **one canonical icon per source kind**. The source of truth is
`SOURCE_KIND_ICONS` in
`packages/app/src/components/sourceSelectUtils.tsx`. Never invent a different
icon for a source kind (e.g. don't use `IconTimeline` for a trace) — always
match the table below so icons stay consistent across the app.

## Canonical mapping

| Source kind (`SourceKind`) | Tabler icon      | Meaning                       |
| -------------------------- | ---------------- | ----------------------------- |
| `Log`                      | `IconLogs`       | Logs                          |
| `Trace`                    | `IconConnection` | Traces / spans                |
| `Session`                  | `IconDeviceLaptop` | Session replay / client sessions |
| `Metric`                   | `IconChartLine`  | Metrics                       |
| `Promql`                   | `IconChartLine`  | PromQL metrics (same as Metric) |

All imported from `@tabler/icons-react`.

## Rules

1. **Prefer the shared map.** When you need a source-kind icon in a context that
   already has (or can accept) a `SourceKind`, use `SOURCE_KIND_ICONS[kind]`
   from `sourceSelectUtils.tsx` rather than hardcoding an icon component.
2. **If you must hardcode** (e.g. a fixed "View Trace" action that always points
   at a trace), import the exact icon from the table above — for a trace that is
   `IconConnection`, not `IconTimeline`/`IconRoute`/etc.
3. **Sizing**: the shared map uses `size={16}`. Match the surrounding UI; small
   inline buttons/badges commonly use `14`.
4. **Adding a new source kind**: update `SOURCE_KIND_ICONS` first, then update
   this table so the two never drift.

## Examples

Cross-source "View Trace" action (fixed target → hardcode the trace icon):

```tsx
import { IconConnection } from '@tabler/icons-react';

<Button leftSection={<IconConnection size={14} />}>View Trace</Button>;
```

Dynamic, kind-driven icon (prefer the shared map):

```tsx
import { SOURCE_KIND_ICONS } from '@/components/sourceSelectUtils';

<span>{SOURCE_KIND_ICONS[source.kind]}</span>;
```
