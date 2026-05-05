/**
 * Chart rendering views for the MCP widget.
 *
 * The line view delegates to `<TimeSeriesView>` from
 * `@hyperdx/chart-presenters`: the same presenter the dashboard uses, so
 * the widget renders pixel-identically to a dashboard tile. Table, number,
 * and pie remain hand-rolled / inline-recharts for now (they're simple
 * enough that extraction doesn't pay back yet).
 */
import { useMemo } from 'react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  TimeSeriesView,
  type SeriesDescriptor,
  type TimeSeriesDataRow,
} from '@hyperdx/chart-presenters';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ResponseRow = Record<string, string | number | null>;
export type ResponseMetaItem = { name: string; type: string };
export interface StructuredContent {
  displayType: string;
  config?: {
    name?: string;
    displayType?: string;
  } & Record<string, unknown>;
  data?: {
    meta?: ResponseMetaItem[];
    data?: ResponseRow[];
    rows?: number;
  };
  links?: {
    openInHyperdxUrl?: string;
  };
}

// ─── Color palette ───────────────────────────────────────────────────────────

const COLORS = [
  '#50e3c2',
  '#f5a623',
  '#bd10e0',
  '#7ed321',
  '#4a90e2',
  '#d0021b',
  '#9013fe',
  '#f8e71c',
];

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

function fmtTime(t: number, span: number): string {
  const d = new Date(t);
  if (span > 24 * 3600 * 1000) {
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      })
    );
  }
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Column inference ────────────────────────────────────────────────────────

/**
 * Pick the timestamp column and numeric value columns from a ClickHouse
 * `meta + data` payload. Used by the line view to figure out which column is
 * the X axis and which are series.
 */
function inferColumns(
  meta: ResponseMetaItem[] | undefined,
  data: ResponseRow[] | undefined,
): { tsKey: string | null; valueKeys: string[] } {
  if (!meta || !data || data.length === 0) {
    return { tsKey: null, valueKeys: [] };
  }
  let tsKey: string | null = null;
  const valueKeys: string[] = [];
  for (const m of meta) {
    const t = String(m.type || '').toLowerCase();
    if (
      !tsKey &&
      (t.includes('datetime') || t.includes('date') || t === 'string')
    ) {
      const v = data[0]?.[m.name];
      if (v != null && !Number.isNaN(new Date(String(v)).getTime())) {
        tsKey = m.name;
        continue;
      }
    }
    if (
      t.includes('int') ||
      t.includes('float') ||
      t.includes('decimal') ||
      t.includes('uint')
    ) {
      valueKeys.push(m.name);
    }
  }
  // Fallback: probe first column as timestamp
  if (!tsKey && data[0]) {
    const firstKey = Object.keys(data[0])[0];
    if (
      firstKey &&
      !Number.isNaN(new Date(String(data[0][firstKey])).getTime())
    ) {
      tsKey = firstKey;
      const idx = valueKeys.indexOf(firstKey);
      if (idx >= 0) valueKeys.splice(idx, 1);
    }
  }
  return { tsKey, valueKeys };
}

// ─── Line chart ──────────────────────────────────────────────────────────────

export function LineChartView({
  structured,
}: {
  structured: StructuredContent;
}) {
  const meta = structured.data?.meta;
  const rows = structured.data?.data ?? [];

  // Convert ClickHouse rows -> presenter input. The presenter expects a
  // bucket key in unix seconds plus one numeric column per series.
  const prepared = useMemo(() => {
    const { tsKey, valueKeys } = inferColumns(meta, rows);
    if (!tsKey || valueKeys.length === 0) return null;

    const points = rows
      .map(r => {
        const ts = new Date(String(r[tsKey])).getTime();
        if (!Number.isFinite(ts)) return null;
        const out: TimeSeriesDataRow = { ts_bucket: Math.floor(ts / 1000) };
        for (const k of valueKeys) {
          const v = Number(r[k]);
          out[k] = Number.isFinite(v) ? v : null;
        }
        return out;
      })
      .filter((p): p is TimeSeriesDataRow => p != null)
      .sort(
        (a, b) =>
          (a.ts_bucket as number) - (b.ts_bucket as number),
      );
    if (points.length === 0) return null;

    const series: SeriesDescriptor[] = valueKeys.map(k => ({
      key: k,
      displayName: k,
    }));

    const tMinMs = (points[0].ts_bucket as number) * 1000;
    const tMaxMs = (points[points.length - 1].ts_bucket as number) * 1000;
    return {
      data: points,
      series,
      dateRange: [new Date(tMinMs), new Date(tMaxMs)] as [Date, Date],
    };
  }, [meta, rows]);

  if (!prepared) {
    return rows.length === 0 ? (
      <div className="empty">No data in range.</div>
    ) : (
      <div className="error">
        Could not infer timestamp/value columns from result.
        <br />
        Columns: {meta?.map(m => `${m.name}:${m.type}`).join(', ')}
      </div>
    );
  }

  const isStackedBar = structured.displayType === 'stacked_bar';

  return (
    <TimeSeriesView
      data={prepared.data}
      series={prepared.series}
      dateRange={prepared.dateRange}
      displayType={isStackedBar ? 'stacked_bar' : 'line'}
      height={280}
    />
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

export function TableView({ structured }: { structured: StructuredContent }) {
  const meta = structured.data?.meta;
  const rows = structured.data?.data ?? [];

  if (rows.length === 0) {
    return <div className="empty">No data.</div>;
  }
  const cols =
    meta && meta.length > 0
      ? meta.map(m => m.name)
      : Object.keys(rows[0] ?? {});
  const display = rows.slice(0, 100);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {display.map((r, i) => (
            <tr key={i}>
              {cols.map(c => (
                <td key={c}>{String(r[c] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > display.length && (
        <div className="meta">
          Showing first {display.length} of {rows.length} rows
        </div>
      )}
    </div>
  );
}

// ─── Number ──────────────────────────────────────────────────────────────────

export function NumberView({ structured }: { structured: StructuredContent }) {
  const rows = structured.data?.data ?? [];
  if (rows.length === 0) {
    return <div className="empty">No data.</div>;
  }
  const row = rows[0] ?? {};
  const valKey = Object.keys(row).find(
    k => row[k] != null && !Number.isNaN(Number(row[k])),
  );
  const value = valKey != null ? row[valKey] : null;
  const display =
    value != null && Number.isFinite(Number(value))
      ? Number(value).toLocaleString()
      : String(value ?? '-');
  return <div className="big-number">{display}</div>;
}

// ─── Pie ─────────────────────────────────────────────────────────────────────

export function PieView({ structured }: { structured: StructuredContent }) {
  const meta = structured.data?.meta;
  const rows = structured.data?.data ?? [];

  const slices = useMemo(() => {
    if (rows.length === 0 || !meta) return [];

    // Pick the numeric column as the value, the first non-numeric as the label.
    let valueKey: string | undefined;
    let labelKey: string | undefined;
    for (const m of meta) {
      const t = String(m.type || '').toLowerCase();
      const isNumeric =
        t.includes('int') ||
        t.includes('float') ||
        t.includes('decimal') ||
        t.includes('uint');
      if (isNumeric && !valueKey) valueKey = m.name;
      else if (!isNumeric && !labelKey) labelKey = m.name;
    }
    if (!valueKey) return [];

    return rows
      .map(r => ({
        name: labelKey ? String(r[labelKey] ?? '-') : 'value',
        value: Number(r[valueKey!]),
      }))
      .filter(s => Number.isFinite(s.value) && s.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [meta, rows]);

  if (slices.length === 0) {
    return <div className="empty">No data.</div>;
  }

  const COLORS = [
    '#50e3c2',
    '#f5a623',
    '#bd10e0',
    '#7ed321',
    '#4a90e2',
    '#d0021b',
    '#9013fe',
    '#f8e71c',
  ];

  return (
    <div style={{ width: '100%' }}>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={104}
            paddingAngle={1}
            isAnimationActive={false}
            label={({ name, percent }: { name?: string; percent?: number }) =>
              `${name ?? ''} ${percent != null ? `${(percent * 100).toFixed(0)}%` : ''}`
            }
            labelLine={false}
          >
            {slices.map((s, i) => (
              <Cell key={s.name} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            cursor={{ fill: 'rgba(154, 160, 166, 0.08)' }}
            contentStyle={{
              background: 'rgba(20, 23, 28, 0.96)',
              color: '#e8eaed',
              border: '1px solid #2a2d33',
              borderRadius: 4,
              fontSize: 11,
            }}
            formatter={(v: number, name: string) => [
              v.toLocaleString(),
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
