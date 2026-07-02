import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Code,
  Divider,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconExternalLink, IconSearch } from '@tabler/icons-react';

type Language = 'sql' | 'lucene';

type Row = { expr: string; desc: string };
type Section = { title: string; rows: Row[] };

const SQL_SECTIONS: Section[] = [
  {
    title: 'String matching',
    rows: [
      { expr: "ServiceName = 'api'", desc: 'Exact match' },
      { expr: "Body = 'connection refused'", desc: 'Exact phrase match' },
      {
        expr: "Body ILIKE '%timeout%'",
        desc: 'Substring search (case-insensitive)',
      },
      {
        expr: "hasAllTokens(Body, 'connection timeout')",
        desc: 'Full-text search (requires text index)',
      },
      {
        expr: "ServiceName LIKE 'auth-%'",
        desc: 'Prefix wildcard (case-sensitive)',
      },
      { expr: "SpanName LIKE '%checkout%'", desc: 'Substring match' },
      { expr: "Body ILIKE '%error%'", desc: 'Case-insensitive substring' },
      {
        expr: "match(SpanName, '^/api/(checkout|payment)/.*')",
        desc: 'Regular expression',
      },
    ],
  },
  {
    title: 'Boolean operators',
    rows: [
      {
        expr: "ServiceName = 'api' AND SpanName = 'checkout'",
        desc: 'Both must match',
      },
      {
        expr: "ServiceName = 'api' OR ServiceName = 'worker'",
        desc: 'Either matches',
      },
      {
        expr: "ServiceName IN ('api', 'worker')",
        desc: 'Match multiple values',
      },
      { expr: "ServiceName != 'healthcheck'", desc: 'Exclude a value' },
      {
        expr: "(StatusCode = 500 OR StatusCode = 503) AND ServiceName = 'api'",
        desc: 'Nested boolean logic',
      },
      { expr: 'Duration > 1000000', desc: 'Numeric comparison' },
      { expr: 'Duration BETWEEN 100 AND 1000', desc: 'Range (inclusive)' },
      { expr: 'Duration / 1e6 > 100', desc: 'Math expression' },
    ],
  },
  {
    title: 'Existence & absence',
    rows: [
      { expr: 'isNotNull(StatusCode)', desc: 'Field exists / is not null' },
      { expr: 'isNull(Body)', desc: 'Field is absent / null' },
    ],
  },
  {
    title: 'Map',
    rows: [
      {
        expr: "LogAttributes['http.method'] = 'POST'",
        desc: 'Access map/attribute column by key',
      },
      {
        expr: "ResourceAttributes['service.env'] = 'prod'",
        desc: 'Resource attribute filter',
      },
    ],
  },
  {
    title: 'Arrays',
    rows: [
      {
        expr: "has(Events.Name, 'exception')",
        desc: 'Array column contains value (traces)',
      },
    ],
  },
];

const LUCENE_SECTIONS: Section[] = [
  {
    title: 'String matching',
    rows: [
      { expr: 'ServiceName:api', desc: 'Exact match' },
      { expr: '"connection refused"', desc: 'Exact phrase match' },
      { expr: 'timeout', desc: 'Full-text search' },
      { expr: 'ServiceName:auth-*', desc: 'Prefix wildcard' },
      { expr: 'SpanName:*checkout*', desc: 'Substring wildcard' },
      { expr: 'SpanName:*checkout', desc: 'Suffix wildcard' },
      { expr: 'Duration:[100 TO 500]', desc: 'Numeric range (inclusive)' },
      { expr: 'Duration:{100 TO 500}', desc: 'Numeric range (exclusive)' },
      { expr: 'Duration:>1000000', desc: 'Greater-than comparison' },
    ],
  },
  {
    title: 'Boolean operators',
    rows: [
      {
        expr: 'ServiceName:api AND SpanName:checkout',
        desc: 'Both conditions must match',
      },
      {
        expr: 'ServiceName:api OR ServiceName:worker',
        desc: 'Either condition matches',
      },
      {
        expr: 'ServiceName:(api OR worker)',
        desc: 'Match multiple values for one field',
      },
      { expr: 'NOT ServiceName:healthcheck', desc: 'Exclude matches' },
      { expr: '-ServiceName:healthcheck', desc: 'Shorthand for NOT' },
      {
        expr: '(ServiceName:api OR ServiceName:worker) AND StatusCode:500',
        desc: 'Nested boolean logic',
      },
    ],
  },
  {
    title: 'Existence & absence',
    rows: [
      { expr: 'StatusCode:*', desc: 'Field exists (not null)' },
      { expr: '-Body:*', desc: 'Field is absent / null' },
    ],
  },
  {
    title: 'Map',
    rows: [
      {
        expr: 'LogAttributes.http.method:POST',
        desc: 'Access map/attribute column by key',
      },
      {
        expr: 'ResourceAttributes.service.env:prod',
        desc: 'Resource attribute filter',
      },
    ],
  },
  {
    title: 'Arrays',
    rows: [
      {
        expr: 'Events.Name:exception',
        desc: 'Array column contains value (traces)',
      },
    ],
  },
];

function filterSections(sections: Section[], query: string): Section[] {
  if (!query.trim()) return sections;
  const q = query.toLowerCase();
  return sections
    .map(section => ({
      ...section,
      rows: section.rows.filter(
        row =>
          row.expr.toLowerCase().includes(q) ||
          row.desc.toLowerCase().includes(q),
      ),
    }))
    .filter(section => section.rows.length > 0);
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{
          background: 'var(--mantine-color-yellow-4)',
          color: 'inherit',
          borderRadius: 2,
          padding: '0 1px',
        }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SyntaxTable({
  sections,
  query,
}: {
  sections: Section[];
  query: string;
}) {
  const filtered = useMemo(
    () => filterSections(sections, query),
    [sections, query],
  );

  if (filtered.length === 0) {
    return (
      <Text size="sm" style={{ color: 'var(--color-text-muted)' }} mt="sm">
        No results for &ldquo;{query}&rdquo;
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {filtered.map((section, si) => (
        <Box key={section.title}>
          {si > 0 && <Divider mb={4} />}
          <Title
            order={6}
            mt="sm"
            mb={4}
            style={{ color: 'var(--color-text)' }}
          >
            {section.title}
          </Title>
          <Table withColumnBorders={false} withRowBorders={false} fz="sm">
            <Table.Tbody>
              {section.rows.map(row => (
                <Table.Tr key={row.expr}>
                  <Table.Td style={{ width: '55%' }}>
                    <Code
                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                    >
                      <Highlight text={row.expr} query={query} />
                    </Code>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="sm"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <Highlight text={row.desc} query={query} />
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Box>
      ))}
    </Stack>
  );
}

const INTRO: Record<Language, string> = {
  sql: '',
  lucene: '',
};

export default function SyntaxReferenceModal({
  opened,
  onClose,
  language: initialLanguage,
}: {
  opened: boolean;
  onClose: () => void;
  language: Language;
}) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [query, setQuery] = useState('');

  // Sync tab when the modal opens or caller switches language externally
  useEffect(() => {
    if (opened) setLanguage(initialLanguage);
  }, [opened, initialLanguage]);

  const sections = language === 'sql' ? SQL_SECTIONS : LUCENE_SECTIONS;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={<Text fw={600}>Search Syntax Reference</Text>}
      size="xl"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="sm" pb="md">
        <Group align="center">
          <SegmentedControl
            size="xs"
            value={language}
            onChange={val => {
              setLanguage(val as Language);
              setQuery('');
            }}
            data={[
              { value: 'lucene', label: 'Lucene' },
              { value: 'sql', label: 'SQL' },
            ]}
          />
          <TextInput
            placeholder="Filter examples…"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
            autoFocus
            size="xs"
            style={{ flex: 1 }}
          />
          <Tooltip label="ClickStack search documentation" withArrow>
            <Text
              size="xs"
              c="dimmed"
              component="a"
              href="https://clickhouse.com/docs/use-cases/observability/clickstack/search"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', lineHeight: 1 }}
            >
              <IconExternalLink size={14} />
            </Text>
          </Tooltip>
        </Group>
        {INTRO[language] && (
          <Text size="sm" c="dimmed" ta="center">
            {INTRO[language]}
          </Text>
        )}
        <SyntaxTable sections={sections} query={query} />
      </Stack>
    </Modal>
  );
}
