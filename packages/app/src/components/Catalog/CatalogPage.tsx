import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Box, Group, Paper, Stack, Text } from '@mantine/core';
import { IconFolderOpen } from '@tabler/icons-react';

import { CatalogTableDetail } from './CatalogTableDetail';
import { CatalogTree, CatalogTreeSelection } from './CatalogTree';

interface Props {
  initial?: CatalogTreeSelection;
}

/**
 * Two-pane Catalog browser. The deep-link route
 * `/catalog/[catalogId]/[database]/[table]` reuses this component with
 * `initial` populated from the URL — keeps the lazy tree loading consistent
 * regardless of how the user got here.
 */
function CatalogPage({ initial }: Props) {
  const router = useRouter();
  const [selection, setSelection] = useState<CatalogTreeSelection | null>(
    initial ?? null,
  );

  const handleSelectTable = (sel: CatalogTreeSelection) => {
    setSelection(sel);
    // Keep the URL in sync for sharing / deep-linking. Use shallow=true so
    // we don't re-render the page, only update the URL.
    router.push(
      `/catalog/${encodeURIComponent(sel.catalogId)}/${encodeURIComponent(sel.database)}/${encodeURIComponent(sel.table)}`,
      undefined,
      { shallow: true },
    );
  };

  return (
    <Box style={{ display: 'flex', height: '100%', width: '100%' }}>
      <Paper
        withBorder
        radius={0}
        style={{
          width: 320,
          minWidth: 240,
          display: 'flex',
          flexDirection: 'column',
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
        }}
      >
        <Group
          gap={6}
          px="sm"
          py="xs"
          style={{ borderBottom: '1px solid var(--mantine-color-dark-5)' }}
        >
          <IconFolderOpen size={14} />
          <Text size="sm" fw={600}>
            Catalog
          </Text>
        </Group>
        <Box style={{ flex: 1, minHeight: 0 }}>
          <CatalogTree
            selection={selection}
            onSelectTable={handleSelectTable}
          />
        </Box>
      </Paper>

      <Box style={{ flex: 1, padding: 16, overflow: 'auto', minWidth: 0 }}>
        {selection ? (
          <CatalogTableDetail
            catalogId={selection.catalogId}
            database={selection.database}
            table={selection.table}
          />
        ) : (
          <Stack align="center" justify="center" h="100%" gap="xs">
            <IconFolderOpen size={32} stroke={1.2} opacity={0.4} />
            <Text size="sm" c="dimmed">
              Pick a table from the tree to inspect its schema, sample rows, DDL
              and stats.
            </Text>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

export default CatalogPage;
