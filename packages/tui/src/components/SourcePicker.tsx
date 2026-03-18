import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { SourceResponse } from '@/api/client';

interface SourcePickerProps {
  sources: SourceResponse[];
  onSelect: (source: SourceResponse) => void;
}

export default function SourcePicker({ sources, onSelect }: SourcePickerProps) {
  const [selected, setSelected] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1));
    }
    if (key.downArrow) {
      setSelected(s => Math.min(sources.length - 1, s + 1));
    }
    if (key.return) {
      onSelect(sources[selected]);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">
        Select a source:
      </Text>
      <Text> </Text>
      {sources.map((source, i) => (
        <Text key={source.id} color={i === selected ? 'green' : undefined}>
          {i === selected ? '▸ ' : '  '}
          {source.name}{' '}
          <Text dimColor>
            ({source.from.databaseName}.{source.from.tableName})
          </Text>
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>↑/↓ to navigate, Enter to select</Text>
    </Box>
  );
}
