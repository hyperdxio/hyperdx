import React, { useMemo, useState } from 'react';
import type { GlueTableSummary } from '@berg/common-utils/dist/glue/types';
import {
  Box,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useQueries } from '@tanstack/react-query';
import {
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconFolder,
  IconSearch,
  IconTable,
} from '@tabler/icons-react';

import { hdxServer } from '@/api';
import { useCatalogs } from '@/hooks/useCatalogs';
import { useDatabases } from '@/hooks/useDatabases';
import { useTables } from '@/hooks/useTables';

interface DatabasesResponse {
  databases: string[];
}
interface TablesResponse {
  tables: GlueTableSummary[];
}

/**
 * Fan-out fetch of every database under every catalog and every table under
 * every (catalog, database). Driven only when a non-empty filter is active so
 * we keep the lazy-load contract in the common case. The query keys are
 * identical to `useDatabases` / `useTables`, so the React Query cache is
 * shared with the per-node hooks the tree already uses for rendering.
 */
function useCatalogSearchIndex({
  catalogs,
  enabled,
}: {
  catalogs: string[];
  enabled: boolean;
}) {
  const dbResults = useQueries({
    queries: catalogs.map(c => ({
      queryKey: ['catalog', 'databases', c],
      queryFn: () =>
        hdxServer(`v1/catalogs/${encodeURIComponent(c)}/databases`)
          .json<DatabasesResponse>()
          .then(r => r.databases),
      enabled,
    })),
  });

  const dbsByCatalog = useMemo(() => {
    const m = new Map<string, string[]>();
    catalogs.forEach((c, i) => m.set(c, dbResults[i]?.data ?? []));
    return m;
  }, [catalogs, dbResults]);

  const dbPairs = useMemo(() => {
    const pairs: { catalogId: string; database: string }[] = [];
    dbsByCatalog.forEach((dbs, c) =>
      dbs.forEach(d => pairs.push({ catalogId: c, database: d })),
    );
    return pairs;
  }, [dbsByCatalog]);

  const tableResults = useQueries({
    queries: dbPairs.map(({ catalogId, database }) => ({
      queryKey: ['catalog', 'tables', catalogId, database],
      queryFn: () =>
        hdxServer(
          `v1/catalogs/${encodeURIComponent(catalogId)}/databases/${encodeURIComponent(database)}/tables`,
        )
          .json<TablesResponse>()
          .then(r => r.tables),
      enabled,
    })),
  });

  const tablesByPair = useMemo(() => {
    const m = new Map<string, GlueTableSummary[]>();
    dbPairs.forEach(({ catalogId, database }, i) =>
      m.set(`${catalogId}::${database}`, tableResults[i]?.data ?? []),
    );
    return m;
  }, [dbPairs, tableResults]);

  return { dbsByCatalog, tablesByPair };
}

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
 * roles don't pay for branches the user never opens.
 *
 * When the user types into the top-of-pane filter, we fan out database and
 * table fetches across every catalog (`useCatalogSearchIndex`) so the filter
 * matches at any depth. Catalogs / databases that have a matching descendant
 * auto-expand so the matching leaf is visible without manual navigation.
 * The fan-out only fires while a filter is active, preserving the lazy
 * contract for the common case.
 */
export function CatalogTree({ selection, onSelectTable }: CatalogTreeProps) {
  const [filter, setFilter] = useState('');
  const { data: catalogs, isLoading, isError } = useCatalogs();

  const filterLower = filter.trim().toLowerCase();
  const filterActive = filterLower.length > 0;

  const { dbsByCatalog, tablesByPair } = useCatalogSearchIndex({
    catalogs: catalogs ?? [],
    enabled: filterActive,
  });

  const matches = (s: string) => s.toLowerCase().includes(filterLower);

  // Catalog is visible if its name matches OR any of its loaded descendants
  // match. Auto-expansion only fires when at least one descendant matched —
  // a name-only catalog match keeps its children collapsed (the user knows
  // what they typed; we don't open a tree of unrelated tables).
  const matchByCatalog = useMemo(() => {
    if (!filterActive) return null;
    const m = new Map<
      string,
      { selfMatch: boolean; descendantMatch: boolean }
    >();
    (catalogs ?? []).forEach(c => {
      const selfMatch = matches(c);
      const dbs = dbsByCatalog.get(c) ?? [];
      const descendantMatch =
        dbs.some(d => matches(d)) ||
        dbs.some(d =>
          (tablesByPair.get(`${c}::${d}`) ?? []).some(t => matches(t.table)),
        );
      m.set(c, { selfMatch, descendantMatch });
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterActive, catalogs, dbsByCatalog, tablesByPair, filterLower]);

  const filteredCatalogs = useMemo(() => {
    if (!catalogs) return [];
    if (!filterActive) return catalogs;
    return catalogs.filter(c => {
      const m = matchByCatalog?.get(c);
      return !!m && (m.selfMatch || m.descendantMatch);
    });
  }, [catalogs, filterActive, matchByCatalog]);

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
              No matches.
            </Text>
          )}
          {filteredCatalogs.map(catalogId => (
            <CatalogNode
              key={catalogId}
              catalogId={catalogId}
              filter={filterLower}
              filterActive={filterActive}
              autoExpand={
                !!matchByCatalog?.get(catalogId)?.descendantMatch
              }
              tablesByPair={tablesByPair}
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
  filterActive,
  autoExpand,
  tablesByPair,
  selection,
  onSelectTable,
}: {
  catalogId: string;
  filter: string;
  filterActive: boolean;
  autoExpand: boolean;
  tablesByPair: Map<string, GlueTableSummary[]>;
  selection?: CatalogTreeSelection | null;
  onSelectTable: (sel: CatalogTreeSelection) => void;
}) {
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const expanded = manuallyExpanded || autoExpand;
  // Pull from cache via the shared queryKey; the search-index hook in the
  // parent already pre-warmed this when filterActive, so no extra fetch.
  const { data: databases, isFetching } = useDatabases(
    expanded ? catalogId : undefined,
  );

  const filteredDatabases = useMemo(() => {
    if (!databases) return [];
    if (!filter) return databases;
    // When filterActive, include databases whose own name matches OR any of
    // their tables match — the table data is already in `tablesByPair`.
    return databases.filter(d => {
      if (d.toLowerCase().includes(filter)) return true;
      const tables = tablesByPair.get(`${catalogId}::${d}`) ?? [];
      return tables.some(t => t.table.toLowerCase().includes(filter));
    });
  }, [databases, filter, tablesByPair, catalogId]);

  const ChevIcon = expanded ? IconChevronDown : IconChevronRight;

  return (
    <Box>
      <TreeRow
        onClick={() => setManuallyExpanded(v => !v)}
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
          {filteredDatabases.map(database => {
            const dbTables =
              tablesByPair.get(`${catalogId}::${database}`) ?? [];
            const dbHasTableMatch =
              filterActive && dbTables.some(t => matchesFilter(t.table, filter));
            return (
              <DatabaseNode
                key={database}
                catalogId={catalogId}
                database={database}
                filter={filter}
                filterActive={filterActive}
                autoExpand={dbHasTableMatch}
                selection={selection}
                onSelectTable={onSelectTable}
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

function matchesFilter(s: string, filter: string): boolean {
  if (!filter) return true;
  return s.toLowerCase().includes(filter);
}

function DatabaseNode({
  catalogId,
  database,
  filter,
  filterActive: _filterActive,
  autoExpand,
  selection,
  onSelectTable,
}: {
  catalogId: string;
  database: string;
  filter: string;
  filterActive: boolean;
  autoExpand: boolean;
  selection?: CatalogTreeSelection | null;
  onSelectTable: (sel: CatalogTreeSelection) => void;
}) {
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const expanded = manuallyExpanded || autoExpand;
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
        onClick={() => setManuallyExpanded(v => !v)}
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
