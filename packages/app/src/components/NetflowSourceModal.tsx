import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { Modal } from '@mantine/core';

import { TableSourceForm } from '@/components/Sources/SourceForm';

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
