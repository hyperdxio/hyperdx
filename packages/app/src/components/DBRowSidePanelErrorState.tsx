import Link from 'next/link';
import {
  ClickHouseQueryError,
  isMissingColumnError,
} from '@hyperdx/common-utils/dist/clickhouse';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import {
  isLogSource,
  isTraceSource,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Alert, Anchor, Button, Code, Modal, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertTriangle } from '@tabler/icons-react';

import { IS_LOCAL_MODE } from '@/config';
import { useTableMetadata } from '@/hooks/useMetadata';
import { useBrandDisplayName } from '@/theme/ThemeProvider';

import { TableSourceForm } from './Sources/SourceForm';
import { SQLPreview } from './ChartSQLPreview';

const SelectStar = () => (
  <Text span ff="monospace">
    SELECT *
  </Text>
);

/** A hint to the user that setting the Known Columns List may resolve SELECT * failures on Distributed or Merge tables */
function KnownColumnsListHint({
  onEditClick,
  source,
}: {
  onEditClick?: () => void;
  source: TSource;
}) {
  const brand = useBrandDisplayName();
  const hasKnownColumnsList =
    (isLogSource(source) || isTraceSource(source)) &&
    !!source.knownColumnsListExpression;

  const message = hasKnownColumnsList ? (
    <>
      To show every field for a row, {brand} loads the full row using the{' '}
      <b>Known Columns List</b> configured on this source (instead of a{' '}
      <SelectStar /> query). This likely failed because the list references a
      column that doesn&apos;t exist in every target table of the Distributed or
      Merge table. Update the <b>Known Columns List</b> so it only includes
      columns present in all target tables.
    </>
  ) : (
    <>
      To show every field for this row, {brand} loads the full row with a{' '}
      <SelectStar /> query. This failed because a column declared by the parent
      (distributed) table is missing from at least one target table. To fix
      this, set a <b>Known Columns List</b> on this source, specifying a list of
      columns that every target table has. When set, {brand} will select those
      columns instead of <SelectStar />.
    </>
  );

  return (
    <Alert
      color="yellow"
      icon={<IconAlertTriangle size={16} />}
      title="Failed to load row details from distributed or merge table"
      data-testid="known-columns-list-hint"
    >
      <Stack gap="xs" align="start">
        <Text size="sm">{message}</Text>
        {IS_LOCAL_MODE ? (
          <Button size="xs" variant="subtle" onClick={onEditClick}>
            Edit source settings
          </Button>
        ) : (
          <Anchor component={Link} href={`/team#source-${source.id}`} size="sm">
            Edit source settings
          </Anchor>
        )}
      </Stack>
    </Alert>
  );
}

export function DBRowSidePanelErrorState({
  error,
  source,
}: {
  error: Error | ClickHouseQueryError;
  source: TSource;
}) {
  const [editOpened, editModal] = useDisclosure(false);
  const { data: tableMetadata } = useTableMetadata(tcFromSource(source));

  const showHint =
    isMissingColumnError(error) && !!tableMetadata?.isPointerTable;

  return (
    <Stack gap="sm" data-testid="row-error-state">
      <Text>Error loading row data</Text>

      {showHint && (
        <KnownColumnsListHint onEditClick={editModal.open} source={source} />
      )}

      <Stack align="start">
        <Text size="sm" mt={10}>
          Error Message:
        </Text>
        <Code
          flex={1}
          block
          style={{
            whiteSpace: 'pre-wrap',
            maxWidth: '100%',
          }}
        >
          {error.message}
        </Code>
        {error instanceof ClickHouseQueryError && (
          <>
            <Text size="sm" ta="center">
              Sent Query:
            </Text>
            <SQLPreview data={error?.query} enableLineWrapping enableCopy />
          </>
        )}
      </Stack>
      {IS_LOCAL_MODE && (
        <Modal
          opened={editOpened}
          onClose={editModal.close}
          title="Edit Source"
          size="xl"
        >
          <TableSourceForm sourceId={source.id} onSave={editModal.close} />
        </Modal>
      )}
    </Stack>
  );
}
