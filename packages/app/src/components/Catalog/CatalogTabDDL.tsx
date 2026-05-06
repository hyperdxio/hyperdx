import React, { useMemo } from 'react';
import type { GlueTableSchema } from '@berg/common-utils/dist/glue/types';
import { Code, CopyButton, Group, Stack, Text, Tooltip } from '@mantine/core';
import { ActionIcon } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';

interface Props {
  schema: GlueTableSchema;
}

function quote(id: string) {
  return `"${id.replace(/"/g, '""')}"`;
}

/**
 * Synthesize a best-effort `CREATE TABLE` from the Glue metadata. This is
 * for human inspection only — Athena's `SHOW CREATE TABLE` produces the
 * canonical form, but it requires running a query, which is overkill for
 * the read-only DDL tab. Partition columns are listed at the bottom in a
 * `WITH (partitioned_by = ARRAY[...])` clause, mirroring how Trino renders
 * Hive/Iceberg DDL.
 */
function buildDDL(schema: GlueTableSchema): string {
  const partitionSet = new Set(schema.partitionKeys);
  const dataCols = schema.columns.filter(c => !partitionSet.has(c.name));
  const partitionCols = schema.columns.filter(c => partitionSet.has(c.name));

  const lines: string[] = [];
  lines.push(`CREATE TABLE ${quote(schema.database)}.${quote(schema.table)} (`);
  const colDefs = [...dataCols, ...partitionCols].map(
    c =>
      `  ${quote(c.name)} ${c.type}${c.comment ? ` COMMENT '${c.comment.replace(/'/g, "''")}'` : ''}`,
  );
  lines.push(colDefs.join(',\n'));
  lines.push(')');

  const withClauses: string[] = [];
  if (schema.format !== 'unknown') {
    withClauses.push(`format = '${schema.format}'`);
  }
  if (schema.location) {
    withClauses.push(`external_location = '${schema.location}'`);
  }
  if (partitionCols.length > 0) {
    const arr = partitionCols.map(c => `'${c.name}'`).join(', ');
    withClauses.push(`partitioned_by = ARRAY[${arr}]`);
  }
  if (withClauses.length > 0) {
    lines.push('WITH (');
    lines.push(withClauses.map(c => `  ${c}`).join(',\n'));
    lines.push(')');
  }

  return lines.join('\n');
}

export function CatalogTabDDL({ schema }: Props) {
  const ddl = useMemo(() => buildDDL(schema), [schema]);

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text size="xs" c="dimmed">
          Best-effort DDL synthesized from Glue metadata. For the canonical
          form, run <Code>SHOW CREATE TABLE</Code> in the SQL editor.
        </Text>
        <CopyButton value={ddl} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? 'Copied' : 'Copy DDL'}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color={copied ? 'teal' : 'gray'}
                onClick={copy}
                aria-label="Copy DDL"
              >
                {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
      <Code
        block
        style={{
          fontSize: 12,
          whiteSpace: 'pre',
          maxHeight: 500,
          overflow: 'auto',
        }}
      >
        {ddl}
      </Code>
    </Stack>
  );
}
