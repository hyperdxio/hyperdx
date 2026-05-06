import React, { useMemo, useState } from 'react';
import {
  Box,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFolder,
  IconSearch,
  IconTable,
} from '@tabler/icons-react';

import { useCatalogs } from '@/hooks/useCatalogs';
import { useDatabases } from '@/hooks/useDatabases';
import { useTables } from '@/hooks/useTables';

export interface CatalogTreeSelection {
  catalogId: string;
  database: string;
  table: string;
}

export interface CatalogTreeProps {
  /** Currently selected table, used to highlight the active row. */
  selection?: CatalogTreeSelection | null;
  /** Fired when the user clicks a leaf table node. */
  onSelectTable: (sel: CatalogTreeSelection) => void;
}

/**
 * Three-level lazy tree: Catalog → Database → Table. Each level only fetches
 * its children when expanded for the first time, so partial-permissions IAM
 * roles don't pay for branches the user never opens. The top-of-pane filter
 * does a substring match across already-loaded names; we deliberately don't
 * eagerly load every database/table to make the filter "work everywhere",
 * because that would defeat the lazy load.
 */
export function CatalogTree({ selection, onSelectTable }: CatalogTreeProps) {
  const [filter, setFilter] = useState('');
  const { data: catalogs, isLoading, isError } = useCatalogs();

  const filterLower = filter.trim().toLowerCase();

  const filteredCatalogs = useMemo(() => {
    if (!catalogs) return [];
    if (!filterLower) return catalogs;
    return catalogs.filter(c => c.toLowerCase().includes(filterLower));
  }, [catalogs, filterLower]);

  return (
    <Stack gap={4} h="100%">
      <Box p="xs">
        <TextInput
          size="xs"
          placeholder="Filter catalogs, databases, tables…"
          leftSection={<IconSearch size={14} />}
          value={filter}
          onChange={e => setFilter(e.currentTarget.value)}
          aria-label="Filter catalog tree"
        />
      </Box>
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Stack gap={2} px="xs" pb="xs">
          {isLoading && (
            <Group gap="xs" px="xs" py="xs">
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Loading catalogs…
              </Text>
            </Group>
          )}
          {isError && (
            <Text size="xs" c="red" px="xs">
              Failed to load catalogs.
            </Text>
          )}
          {!isLoading && !isError && filteredCatalogs.length === 0 && (
            <Text size="xs" c="dimmed" px="xs" py="xs">
              No catalogs match.
            </Text>
          )}
          {filteredCatalogs.map(catalogId => (
            <CatalogNode
              key={catalogId}
              catalogId={catalogId}
              filter={filterLower}
              selection={selection}
              onSelectTable={onSelectTable}
            />
          ))}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function CatalogNode({
  catalogId,
  filter,
  selection,
  onSelectTable,
}: {
  catalogId: string;
  filter: string;
  selection?: CatalogTreeSelection | null;
  onSelectTable: (sel: CatalogTreeSelection) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: databases, isFetching } = useDatabases(
    expanded ? catalogId : undefined,
  );

  const filteredDatabases = useMemo(() => {
    if (!databases) return [];
    if (!filter) return databases;
    return databases.filter(d => d.toLowerCase().includes(filter));
  }, [databases, filter]);

  // Auto-expand catalog when filter matches a child name we already loaded.
  // We don't aggressively pre-fetch — the filter operates on the data we've
  // already got, which is the consistent contract.

  const ChevIcon = expanded ? IconChevronDown : IconChevronRight;

  return (
    <Box>
      <TreeRow
        onClick={() => setExpanded(v => !v)}
        active={false}
        icon={<IconFolder size={14} />}
        chevron={<ChevIcon size={12} />}
        label={catalogId}
      />
      {expanded && (
        <Stack gap={1} pl="md">
          {isFetching && !databases && (
            <Group gap="xs" pl="md" py={4}>
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Loading…
              </Text>
            </Group>
          )}
          {databases && filteredDatabases.length === 0 && (
            <Text size="xs" c="dimmed" pl="md" py={4}>
              No databases.
            </Text>
          )}
          {filteredDatabases.map(database => (
            <DatabaseNode
              key={database}
              catalogId={catalogId}
              database={database}
              filter={filter}
              selection={selection}
              onSelectTable={onSelectTable}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

function DatabaseNode({
  catalogId,
  database,
  filter,
  selection,
  onSelectTable,
}: {
  catalogId: string;
  database: string;
  filter: string;
  selection?: CatalogTreeSelection | null;
  onSelectTable: (sel: CatalogTreeSelection) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: tables, isFetching } = useTables(
    expanded ? catalogId : undefined,
    expanded ? database : undefined,
  );

  const filteredTables = useMemo(() => {
    if (!tables) return [];
    if (!filter) return tables;
    return tables.filter(t => t.table.toLowerCase().includes(filter));
  }, [tables, filter]);

  const ChevIcon = expanded ? IconChevronDown : IconChevronRight;

  return (
    <Box>
      <TreeRow
        onClick={() => setExpanded(v => !v)}
        active={false}
        icon={<IconDatabase size={14} />}
        chevron={<ChevIcon size={12} />}
        label={database}
      />
      {expanded && (
        <Stack gap={1} pl="md">
          {isFetching && !tables && (
            <Group gap="xs" pl="md" py={4}>
              <Loader size="xs" />
              <Text size="xs" c="dimmed">
                Loading…
              </Text>
            </Group>
          )}
          {tables && filteredTables.length === 0 && (
            <Text size="xs" c="dimmed" pl="md" py={4}>
              No tables.
            </Text>
          )}
          {filteredTables.map(t => {
            const isActive =
              selection?.catalogId === catalogId &&
              selection?.database === database &&
              selection?.table === t.table;
            return (
              <TreeRow
                key={t.table}
                onClick={() =>
                  onSelectTable({ catalogId, database, table: t.table })
                }
                active={isActive}
                icon={<IconTable size={14} />}
                label={t.table}
                badge={t.format !== 'unknown' ? t.format : undefined}
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

function TreeRow({
  onClick,
  active,
  icon,
  chevron,
  label,
  badge,
}: {
  onClick: () => void;
  active: boolean;
  icon: React.ReactNode;
  chevron?: React.ReactNode;
  label: string;
  badge?: string;
}) {
  return (
    <Group
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      gap={4}
      wrap="nowrap"
      px="xs"
      py={4}
      style={{
        cursor: 'pointer',
        borderRadius: 4,
        background: active ? 'var(--mantine-color-dark-5)' : undefined,
        userSelect: 'none',
      }}
    >
      <Box w={12} style={{ display: 'flex', justifyContent: 'center' }}>
        {chevron}
      </Box>
      {icon}
      <Text
        size="xs"
        fw={active ? 600 : 400}
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </Text>
      {badge && (
        <Text size="9px" c="dimmed" tt="uppercase">
          {badge}
        </Text>
      )}
    </Group>
  );
}

export default CatalogTree;
