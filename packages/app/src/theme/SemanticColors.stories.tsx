import React from 'react';

import { semanticColorsGrouped } from './semanticColorsGrouped';

const story = {
  title: 'Design Tokens/Semantic Colors',
};
export default story;

export const AllSemanticColors = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
    {Object.entries(semanticColorsGrouped).map(([group, tokens]) => (
      <div key={group} style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 12 }}>
          {group.charAt(0).toUpperCase() + group.slice(1)}
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {tokens.map(name => (
            <div key={name} style={{ width: 140 }}>
              <div
                style={{
                  background: `var(--${name})`,
                  height: 40,
                  border: '1px solid var(--color-border)',
                  marginBottom: 8,
                  borderRadius: 4,
                }}
              />
              <div style={{ fontSize: 12 }}>{name}</div>
              <div
                style={{ fontSize: 10, color: '#888' }}
              >{`var(--${name})`}</div>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);
