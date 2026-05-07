import { TSource } from '@hyperdx/common-utils/dist/types';
import { Modal } from '@mantine/core';

import { TableSourceForm } from '@/components/Sources/SourceForm';

type SourceEditModalProps = {
  opened: boolean;
  onClose: () => void;
  inputSource: string | undefined;
};

export function SourceEditModal({
  opened,
  onClose,
  inputSource,
}: SourceEditModalProps) {
  return (
    <Modal size="xl" opened={opened} onClose={onClose} title="Edit Source">
      <TableSourceForm sourceId={inputSource} />
    </Modal>
  );
}

type NewSourceModalProps = {
  opened: boolean;
  onClose: () => void;
  onCreate: (source: TSource) => void;
};

export function NewSourceModal({
  opened,
  onClose,
  onCreate,
}: NewSourceModalProps) {
  return (
    <Modal
      size="xl"
      opened={opened}
      onClose={onClose}
      title="Configure New Source"
    >
      <TableSourceForm isNew defaultName="My New Source" onCreate={onCreate} />
    </Modal>
  );
}
