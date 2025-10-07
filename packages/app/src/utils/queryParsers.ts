import { createParser } from 'nuqs';

// Note: this can be deleted once we upgrade to nuqs v2.2.3
// https://github.com/47ng/nuqs/pull/783
export const parseAsStringWithNewLines = createParser<string>({
  parse: value => value.replace(/%0A/g, '\n'),
  serialize: value => value.replace(/\n/g, '%0A'),
});
