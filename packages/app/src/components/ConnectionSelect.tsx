/**
 * Berg compatibility shim. The Connection model has been deleted; the UI
 * components that import this select are scheduled for removal in
 * Tasks 9/10/11. Until then, this stub keeps imports type-checking.
 */
import { UseControllerProps } from 'react-hook-form';

import SelectControlled from '@/components/SelectControlled';

export function ConnectionSelectControlled({
  size,
  ...props
}: { size?: string } & UseControllerProps<any>) {
  return (
    <SelectControlled
      {...props}
      allowDeselect={false}
      data={[]}
      comboboxProps={{ withinPortal: false }}
      searchable
      placeholder="Connection"
      maxDropdownHeight={280}
      size={size}
    />
  );
}
