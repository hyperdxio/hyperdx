import { useMemo } from 'react';
import { formatDuration } from 'date-fns';
import CopyToClipboard from 'react-copy-to-clipboard';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Group, Table, Text, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconClipboard, IconPlayerTrackNextFilled } from '@tabler/icons-react';

import { buildAlterTableStatements } from '@/hooks/useMaterializationAnalysis/useMaterializationAnalysis';
import { MapReferenceGroup } from '@/hooks/useMaterializationAnalysis/useMaterializationAnalysis.shared';
import { joinDDL, useApplyDDL } from '@/optimizations/useApplyDDL';

import { ColumnKeyList } from './ColumnKeyList';

export function MapReferencesRow({
  referenceGroups,
  source,
}: {
  referenceGroups: MapReferenceGroup;
  source: TSource;
}) {
  const statements = useMemo(
    () => buildAlterTableStatements(source, referenceGroups),
    [source, referenceGroups],
  );
  const copyText = useMemo(() => joinDDL(statements), [statements]);

  const apply = useApplyDDL(source);

  const handleApply = () => {
    apply.mutate(
      { statements },
      {
        onSuccess: () => {
          notifications.show({
            color: 'green',
            message: 'Materialized columns added',
          });
        },
        onError: error => {
          notifications.show({
            color: 'red',
            title: 'Failed to apply ALTER TABLE',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      },
    );
  };

  return (
    <Table.Tr>
      <Table.Td valign="top">
        {referenceGroups.refs.length > 0 && (
          <ColumnKeyList
            column={referenceGroups.refs[0].column}
            keys={referenceGroups.refs.map(k => k.key)}
          />
        )}
      </Table.Td>
      <Table.Td valign="top">
        <Text size="sm">{referenceGroups.queryCount.toLocaleString()}</Text>
      </Table.Td>
      <Table.Td valign="top">
        <Text size="sm">
          {formatDuration({ seconds: referenceGroups.sumDurationMs / 1000 })}
        </Text>
      </Table.Td>
      <Table.Td valign="top">
        <Group gap="xs" wrap="nowrap" justify="end">
          <CopyToClipboard
            text={copyText}
            onCopy={() =>
              notifications.show({
                color: 'green',
                message: 'ALTER TABLE snippet copied',
              })
            }
          >
            <Button
              variant="secondary"
              size="xs"
              leftSection={<IconClipboard size={14} />}
            >
              Copy ALTER TABLE
            </Button>
          </CopyToClipboard>
          <Tooltip
            label={`Add ${referenceGroups.refs.length} materialized column${referenceGroups.refs.length === 1 ? '' : 's'}`}
          >
            <Button
              variant="primary"
              size="xs"
              leftSection={<IconPlayerTrackNextFilled size={14} />}
              loading={apply.isPending}
              onClick={handleApply}
            >
              Apply
            </Button>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
