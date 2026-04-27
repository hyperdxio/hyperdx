import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { SourceResponse } from '@/api/client';

interface SourcePickerProps {
  sources: SourceResponse[];
  onSelect: (source: SourceResponse) => void;
  onOpenAlerts?: () => void;
}

export default function SourcePicker({
  sources,
  onSelect,
  onOpenAlerts,
}: SourcePickerProps) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (input === 'A' && onOpenAlerts) {
      onOpenAlerts();
      return;
    }
    if (key.upArrow || input === 'k') {
      setSelected(s => Math.max(0, s - 1));
    }
    if (key.downArrow || input === 'j') {
      setSelected(s => Math.min(sources.length - 1, s + 1));
    }
    if (key.return || input === 'l') {
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
      <Text dimColor>j/k to navigate, Enter/l to select, A=alerts</Text>
    </Box>
  );
}
