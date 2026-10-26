import { type Field } from '@hyperdx/common-utils/dist/core/metadata';

/** Map column syntax matches the autocomplete: `LogAttributes['level']`. */
export const fieldIdentifier = (field: Field): string =>
  field.path.length > 1
    ? `${field.path[0]}['${field.path[1]}']`
    : field.path[0];
