import { useEffect, useMemo, useState } from 'react';
import { type TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
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

const getSqlSections = (t: TFunction<'search'>): Section[] => [
  {
    title: t('syntax.stringMatching'),
    rows: [
      { expr: "ServiceName = 'api'", desc: t('syntax.exactMatch') },
      {
        expr: "Body = 'connection refused'",
        desc: t('syntax.exactPhraseMatch'),
      },
      {
        expr: "Body ILIKE '%timeout%'",
        desc: t('syntax.substringCaseInsensitive'),
      },
      {
        expr: "Body LIKE '%timeout%'",
        desc: t('syntax.substringCaseSensitive'),
      },
      {
        expr: "hasAllTokens(Body, 'connection timeout')",
        desc: t('syntax.fullTextIndex'),
      },
      {
        expr: "ServiceName LIKE 'auth-%'",
        desc: t('syntax.prefixCaseSensitive'),
      },
      {
        expr: "match(SpanName, '^/api/(checkout|payment)/.*')",
        desc: t('syntax.regularExpression'),
      },
    ],
  },
  {
    title: t('syntax.booleanOperators'),
    rows: [
      {
        expr: "ServiceName = 'api' AND SpanName = 'checkout'",
        desc: t('syntax.bothMustMatch'),
      },
      {
        expr: "ServiceName = 'api' OR ServiceName = 'worker'",
        desc: t('syntax.eitherMatches'),
      },
      {
        expr: "ServiceName IN ('api', 'worker')",
        desc: t('syntax.oneOfMultiple'),
      },
      {
        expr: "ServiceName != 'healthcheck'",
        desc: t('syntax.excludeValue'),
      },
      {
        expr: "(StatusCode = 500 OR StatusCode = 503) AND ServiceName = 'api'",
        desc: t('syntax.nestedBoolean'),
      },
      { expr: 'Duration > 1000000', desc: t('syntax.numericComparison') },
      {
        expr: 'Duration BETWEEN 100 AND 1000',
        desc: t('syntax.inclusiveRange'),
      },
      { expr: 'Duration / 1e6 > 100', desc: t('syntax.mathExpression') },
    ],
  },
  {
    title: t('syntax.existenceAbsence'),
    rows: [
      { expr: 'notEmpty(StatusCode)', desc: t('syntax.fieldExists') },
      { expr: 'empty(Body)', desc: t('syntax.fieldAbsent') },
    ],
  },
  {
    title: t('syntax.map'),
    rows: [
      {
        expr: "LogAttributes['http.method'] = 'POST'",
        desc: t('syntax.mapAccess'),
      },
      {
        expr: "LogAttributes.http.method = 'POST'",
        desc: t('syntax.jsonAccess'),
      },
    ],
  },
  {
    title: t('syntax.arrays'),
    rows: [
      {
        expr: "has(Events.Name, 'exception')",
        desc: t('syntax.arrayContains'),
      },
    ],
  },
];

const getLuceneSections = (t: TFunction<'search'>): Section[] => [
  {
    title: t('syntax.stringMatching'),
    rows: [
      { expr: 'ServiceName:"api"', desc: t('syntax.fieldExactMatch') },
      { expr: 'ServiceName:api', desc: t('syntax.fieldSubstringMatch') },
      {
        expr: '"connection refused"',
        desc: t('syntax.implicitPhraseMatch'),
      },
      { expr: 'timeout', desc: t('syntax.implicitTokenMatch') },
      { expr: 'auth-*', desc: t('syntax.implicitPrefixMatch') },
      { expr: '*-auth', desc: t('syntax.implicitSuffixMatch') },
      { expr: '*checkout*', desc: t('syntax.implicitSubstringMatch') },
      {
        expr: 'Duration:[100 TO 500]',
        desc: t('syntax.numericInclusiveRange'),
      },
      { expr: 'Duration:>1000000', desc: t('syntax.greaterThan') },
    ],
  },
  {
    title: t('syntax.booleanOperators'),
    rows: [
      {
        expr: 'ServiceName:api AND SpanName:checkout',
        desc: t('syntax.bothConditions'),
      },
      {
        expr: 'ServiceName:api OR ServiceName:worker',
        desc: t('syntax.eitherCondition'),
      },
      {
        expr: 'ServiceName:(api OR worker)',
        desc: t('syntax.multipleForField'),
      },
      { expr: 'NOT ServiceName:healthcheck', desc: t('syntax.excludeMatches') },
      { expr: '-ServiceName:healthcheck', desc: t('syntax.shorthandNot') },
      {
        expr: '(ServiceName:api OR ServiceName:worker) AND StatusCode:500',
        desc: t('syntax.nestedBoolean'),
      },
    ],
  },
  {
    title: t('syntax.existenceAbsence'),
    rows: [
      { expr: 'StatusCode:*', desc: t('syntax.existsNonEmpty') },
      { expr: '-Body:*', desc: t('syntax.absentOrEmpty') },
    ],
  },
  {
    title: t('syntax.map'),
    rows: [
      {
        expr: 'LogAttributes.http.method:POST',
        desc: t('syntax.mapByKey'),
      },
      {
        expr: 'ResourceAttributes.service.env:prod',
        desc: t('syntax.mapJsonFilter'),
      },
    ],
  },
  {
    title: t('syntax.arrays'),
    rows: [
      {
        expr: 'Events.Name:"exception"',
        desc: t('syntax.arrayContains'),
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
  const { t } = useTranslation('search');
  const filtered = useMemo(
    () => filterSections(sections, query),
    [sections, query],
  );

  if (filtered.length === 0) {
    return (
      <Text size="sm" style={{ color: 'var(--color-text-muted)' }} mt="sm">
        {t('syntax.noResults', { query })}
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

export default function SyntaxReferenceModal({
  opened,
  onClose,
  language: initialLanguage,
}: {
  opened: boolean;
  onClose: () => void;
  language: Language;
}) {
  const { t } = useTranslation('search');
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [query, setQuery] = useState('');

  // Sync tab when the modal opens or caller switches language externally
  useEffect(() => {
    if (opened) setLanguage(initialLanguage);
  }, [opened, initialLanguage]);

  const sections = useMemo(
    () => (language === 'sql' ? getSqlSections(t) : getLuceneSections(t)),
    [language, t],
  );

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setQuery('');
        onClose();
      }}
      title={<Text fw={600}>{t('syntax.title')}</Text>}
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
            placeholder={t('syntax.filterPlaceholder')}
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
            autoFocus
            size="xs"
            style={{ flex: 1 }}
          />
          <Tooltip label={t('syntax.documentation')} withArrow>
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
        <SyntaxTable sections={sections} query={query} />
      </Stack>
    </Modal>
  );
}
