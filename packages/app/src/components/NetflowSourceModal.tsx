import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Button, Modal } from '@mantine/core';
import { IconNetwork } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { TableSourceForm } from '@/components/Sources/SourceForm';

export function NetflowSourceEmptyState({
  selected,
  onCreate,
}: {
  selected: boolean;
  onCreate: () => void;
}) {
  return (
    <EmptyState
      icon={<IconNetwork size={32} />}
      title={
        selected
          ? 'NetFlow source unavailable'
          : 'No NetFlow sources configured'
      }
      description={
        selected
          ? 'Select an available NetFlow source and run the query, or add a new source.'
          : 'Connect your Akvorado or NetFlow table in ClickHouse to monitor network traffic.'
      }
      variant="card"
    >
      <Button variant="primary" onClick={onCreate}>
        Add NetFlow source
      </Button>
    </EmptyState>
  );
}

export default function NetflowSourceModal({
  mode,
  sourceId,
  onClose,
  onCreate,
}: {
  mode: 'new' | 'edit' | null;
  sourceId?: string;
  onClose: () => void;
  onCreate: (source: TSource) => void;
}) {
  return (
    <Modal
      opened={mode !== null}
      onClose={onClose}
      title={mode === 'edit' ? 'Edit NetFlow source' : 'Add NetFlow source'}
      size="xl"
    >
      <TableSourceForm
        isNew={mode === 'new'}
        sourceId={mode === 'edit' ? sourceId : undefined}
        defaultName="NetFlow"
        defaultKind={SourceKind.Netflow}
        onCreate={onCreate}
        onSave={onClose}
        onCancel={onClose}
      />
    </Modal>
  );
}
