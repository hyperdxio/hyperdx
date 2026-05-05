/**
 * Berg compatibility shim. The Connection model has been deleted; the UI
 * components that import this form are scheduled for removal in
 * Tasks 9/10/11. Until then, this stub keeps imports type-checking.
 */
import { Connection } from '@berg/common-utils/dist/types';

export type ConnectionFormProps = {
  connection?: Connection;
  isNew?: boolean;
  onSave?: () => void;
  onClose?: () => void;
  showCancelButton?: boolean;
  showDeleteButton?: boolean;
};

export function ConnectionForm(_props: ConnectionFormProps) {
  return null;
}
