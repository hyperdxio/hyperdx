import { Control } from 'react-hook-form';
import z from 'zod';
import { OnClick, OnClickSchema } from '@hyperdx/common-utils/dist/types';

export const DrawerSchema = z.object({ onClick: OnClickSchema.nullish() });
export type DrawerFormValues = z.infer<typeof DrawerSchema>;
export type DrawerControl = Control<DrawerFormValues>;

export function emptySearchOnClick(): OnClick {
  return {
    type: 'search',
    target: { mode: 'template', template: '' },
    whereLanguage: 'sql',
  };
}

export function emptyDashboardOnClick(): OnClick {
  return {
    type: 'dashboard',
    target: { mode: 'template', template: '' },
    whereLanguage: 'sql',
  };
}
