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

import { TableSourceForm } from './Sources/SourceForm';
import { SQLPreview } from './ChartSQLPreview';

/** A hint to the user that setting the Known Columns List may resolve SELECT * failures on Distributed or Merge tables */
function KnownColumnsListHint({
  onEditClick,
  source,
}: {
  onEditClick?: () => void;
  source: TSource;
}) {
  const hasKnownColumnsList =
    (isLogSource(source) || isTraceSource(source)) &&
    !!source.knownColumnsListExpression;

  const message = hasKnownColumnsList ? (
    <>
      This query may have failed due to an invalid <b>Known Columns List</b>{' '}
      configuration. Check the <b>Known Columns List</b> for this source and
      ensure that it references valid columns that exist in all target tables of
      the Distributed or Merge table.
    </>
  ) : (
    <>
      This query may have failed due to a{' '}
      <Text span ff="monospace">
        SELECT *
      </Text>{' '}
      query on a Distributed table that declares columns missing in one or more
      of its target tables. If this is the case, the{' '}
      <Text span ff="monospace">
        SELECT *
      </Text>{' '}
      can be overridden by setting a <b>Known Columns List</b> for this source.
    </>
  );

  return (
    <Alert
      color="yellow"
      icon={<IconAlertTriangle size={16} />}
      title="SELECT * failure on Distributed or Merge table"
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
    <Stack gap="sm">
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
