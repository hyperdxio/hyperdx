import { OnClick } from '@hyperdx/common-utils/dist/types';

export function emptySearchOnClick(): OnClick {
  return {
    type: 'search',
    target: { mode: 'template', template: '' },
    whereLanguage: 'sql',
  };
}
