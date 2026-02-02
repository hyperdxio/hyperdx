import React from 'react';

import {
  COLORS,
  getChartColorError,
  getChartColorSuccess,
  getChartColorWarning,
} from '@/utils';

// Labels for chart colors - brand green first, then Observable palette
const COLOR_LABELS = [
  'Green (Brand)',
  'Blue',
  'Orange',
  'Red',
  'Cyan',
  'Pink',
  'Purple',
  'Light Blue',
  'Brown',
  'Gray',
];

// Derive chart colors from the single source of truth in utils.ts
const CHART_COLORS = COLORS.map((hex, i) => ({
  name: `color-chart-${i + 1}`,
  hex,
  label: COLOR_LABELS[i] || `Color ${i + 1}`,
}));

const SEMANTIC_CHART_COLORS = [
  {
    name: 'color-chart-success',
    hex: getChartColorSuccess(),
    label: 'Success (Green)',
  },
  {
    name: 'color-chart-warning',
    hex: getChartColorWarning(),
    label: 'Warning (Orange)',
  },
  {
    name: 'color-chart-error',
    hex: getChartColorError(),
    label: 'Error (Red)',
  },
];

const story = {
  title: 'Design Tokens/Chart Colors',
};
export default story;

// Color swatch component
const ColorSwatch = ({
  name,
  hex,
  label,
}: {
  name: string;
  hex: string;
  label: string;
}) => (
  <div
    style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}
  >
    <div
      style={{
        background: hex,
        width: 40,
        height: 40,
        borderRadius: 6,
        border: '1px solid var(--color-border)',
        flexShrink: 0,
      }}
    />
    <div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {hex}
        </code>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          •
        </span>
        <code style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          var(--{name})
        </code>
      </div>
    </div>
  </div>
);

export const AllChartColors = () => (
  <div style={{ padding: 24 }}>
    <h2 style={{ marginBottom: 24 }}>Chart Color Palette</h2>
    <p style={{ marginBottom: 24, color: 'var(--color-text-muted)' }}>
      Observable categorical color palette - designed to work well on both light
      and dark backgrounds with good contrast and accessibility.
    </p>
    <p
      style={{
        marginBottom: 24,
        fontSize: 12,
        color: 'var(--color-text-muted)',
      }}
    >
      Source:{' '}
      <a
        href="https://observablehq.com/@d3/color-schemes"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--color-text-primary)' }}
      >
        Observable D3 Color Schemes
      </a>
    </p>

    <h3 style={{ fontSize: 16, marginBottom: 16 }}>Data Series Colors</h3>
    <div style={{ marginBottom: 32 }}>
      {CHART_COLORS.map(({ name, hex, label }) => (
        <ColorSwatch key={name} name={name} hex={hex} label={label} />
      ))}
    </div>

    <h3 style={{ fontSize: 16, marginBottom: 16 }}>Semantic Chart Colors</h3>
    <div style={{ marginBottom: 32 }}>
      {SEMANTIC_CHART_COLORS.map(({ name, hex, label }) => (
        <ColorSwatch key={name} name={name} hex={hex} label={label} />
      ))}
    </div>
  </div>
);

export const BarChartPreview = () => {
  const data = [
    { label: 'Jan', values: [65, 45, 30] },
    { label: 'Feb', values: [80, 55, 40] },
    { label: 'Mar', values: [70, 60, 50] },
    { label: 'Apr', values: [90, 70, 45] },
    { label: 'May', values: [85, 65, 55] },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>Bar Chart Preview</h2>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 16,
          height: 200,
          padding: 16,
          background: 'var(--color-bg-surface)',
          borderRadius: 8,
          border: '1px solid var(--color-border)',
        }}
      >
        {data.map(({ label, values }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
              {values.map((value, i) => (
                <div
                  key={i}
                  style={{
                    width: 16,
                    height: value * 1.5,
                    background: CHART_COLORS[i].hex,
                    borderRadius: '2px 2px 0 0',
                  }}
                />
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        {['Series A', 'Series B', 'Series C'].map((name, i) => (
          <div
            key={name}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 2,
                background: CHART_COLORS[i].hex,
              }}
            />
            <span style={{ fontSize: 12 }}>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const LineChartPreview = () => {
  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>Line Chart Preview</h2>
      <div
        style={{
          position: 'relative',
          height: 200,
          padding: 16,
          background: 'var(--color-bg-surface)',
          borderRadius: 8,
          border: '1px solid var(--color-border)',
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 400 150"
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          {[0, 1, 2, 3, 4].map(i => (
            <line
              key={i}
              x1="0"
              y1={i * 37.5}
              x2="400"
              y2={i * 37.5}
              stroke="var(--color-border)"
              strokeWidth="1"
            />
          ))}
          {/* Series 1 - Blue */}
          <polyline
            points="0,100 80,80 160,90 240,50 320,60 400,30"
            fill="none"
            stroke={CHART_COLORS[0].hex}
            strokeWidth="2"
          />
          {/* Series 2 - Orange */}
          <polyline
            points="0,120 80,110 160,100 240,90 320,95 400,70"
            fill="none"
            stroke={CHART_COLORS[1].hex}
            strokeWidth="2"
          />
          {/* Series 3 - Cyan */}
          <polyline
            points="0,140 80,130 160,135 240,120 320,110 400,100"
            fill="none"
            stroke={CHART_COLORS[3].hex}
            strokeWidth="2"
          />
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        {[
          { name: 'Requests', colorIndex: 0 },
          { name: 'Warnings', colorIndex: 1 },
          { name: 'Latency', colorIndex: 3 },
        ].map(({ name, colorIndex }) => (
          <div
            key={name}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <div
              style={{
                width: 16,
                height: 3,
                borderRadius: 1,
                background: CHART_COLORS[colorIndex].hex,
              }}
            />
            <span style={{ fontSize: 12 }}>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SemanticColorsPreview = () => (
  <div style={{ padding: 24 }}>
    <h2 style={{ marginBottom: 24 }}>Semantic Chart Colors</h2>
    <p style={{ marginBottom: 24, color: 'var(--color-text-muted)' }}>
      Use these colors to indicate status in charts (e.g., success rate, error
      count).
    </p>
    <div
      style={{
        display: 'flex',
        gap: 24,
        padding: 16,
        background: 'var(--color-bg-surface)',
        borderRadius: 8,
        border: '1px solid var(--color-border)',
      }}
    >
      {SEMANTIC_CHART_COLORS.map(({ hex, label }, i) => (
        <div key={label} style={{ flex: 1, textAlign: 'center' }}>
          <div
            style={{
              height: 80,
              background: hex,
              borderRadius: 4,
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 600,
              fontSize: 24,
            }}
          >
            {i === 0 ? '98%' : i === 1 ? '15' : '3'}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
          <code style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
            {hex}
          </code>
        </div>
      ))}
    </div>
  </div>
);

export const AccessibilityCheck = () => (
  <div style={{ padding: 24 }}>
    <h2 style={{ marginBottom: 24 }}>Color Accessibility</h2>
    <p style={{ marginBottom: 24, color: 'var(--color-text-muted)' }}>
      The Observable palette is designed to be distinguishable for users with
      color vision deficiencies. Toggle between dark and light mode to verify
      contrast.
    </p>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 8,
        padding: 16,
        background: 'var(--color-bg-surface)',
        borderRadius: 8,
        border: '1px solid var(--color-border)',
      }}
    >
      {CHART_COLORS.map(({ hex, label }, i) => (
        <div
          key={label}
          style={{
            height: 60,
            background: hex,
            borderRadius: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 600,
            fontSize: 12,
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            gap: 2,
          }}
        >
          <span>{i + 1}</span>
          <span style={{ fontSize: 9, fontWeight: 400 }}>{label}</span>
        </div>
      ))}
    </div>
  </div>
);
