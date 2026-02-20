import { createParser } from 'nuqs';
import { SortingState } from '@tanstack/react-table';

import {
  compressStringParam,
  compressUrlParam,
  decompressStringParam,
  decompressUrlParam,
} from './urlCompression';

export const parseAsCompressedString = createParser<string>({
  parse: (value: string) => decompressStringParam(value),
  serialize: (value: string) => compressStringParam(value),
});

export function parseAsCompressedJson<T>() {
  return createParser<T>({
    parse: (value: string) => decompressUrlParam<T>(value),
    serialize: (value: T) => compressUrlParam(value),
  });
}

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
