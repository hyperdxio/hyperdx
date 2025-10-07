import { createParser } from 'nuqs';
import { SortingState } from '@tanstack/react-table';

// Note: this can be deleted once we upgrade to nuqs v2.2.3
// https://github.com/47ng/nuqs/pull/783
export const parseAsStringWithNewLines = createParser<string>({
  parse: value => value.replace(/%0A/g, '\n'),
  serialize: value => value.replace(/\n/g, '%0A'),
});

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
