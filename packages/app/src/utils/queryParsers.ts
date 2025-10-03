import { createParser } from 'nuqs';

export const parseAsStringWithNewLines = createParser<string>({
  parse: value => value.replace(/%0A/g, '\n'),
  serialize: value => value.replace(/\n/g, '%0A'),
});
