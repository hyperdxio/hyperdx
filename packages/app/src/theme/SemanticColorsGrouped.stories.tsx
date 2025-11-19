import React from 'react';

import { semanticColorsGrouped } from './semanticColorsGrouped';

export default {
  title: 'Design Tokens/Semantic Colors Grouped',
};

export const GroupedSemanticColors = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
    {Object.entries(semanticColorsGrouped).map(([group, tokens]) => (
      <div key={group} style={{ minWidth: 180 }}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>
          {group.charAt(0).toUpperCase() + group.slice(1)}
        </h3>
        {tokens.map((name: string) => (
          <div key={name} style={{ marginBottom: 16 }}>
            <div
              style={{
                background: `var(--${name})`,
                height: 40,
                border: '1px solid #ccc',
                marginBottom: 8,
              }}
            />
            <div style={{ fontSize: 12 }}>{name}</div>
            <div
              style={{ fontSize: 10, color: '#888' }}
            >{`var(--${name})`}</div>
          </div>
        ))}
      </div>
    ))}
  </div>
);
