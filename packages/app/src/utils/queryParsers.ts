import { createParser } from 'nuqs';
import { SortingState } from '@tanstack/react-table';

export const parseAsSortingStateString = createParser<SortingState[number]>({
  parse: value => {
    if (!value) {
      return null;
    }
    const keys = value.split(' ');
    const direction = keys.pop();
    const key = keys.join(' ');
    return {
      id: key,
      desc: direction === 'DESC',
    };
  },
  serialize: value => {
    if (!value) {
      return '';
    }
    return `${value.id} ${value.desc ? 'DESC' : 'ASC'}`;
  },
});
