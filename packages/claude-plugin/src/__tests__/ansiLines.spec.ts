import { describe, expect, it } from '@jest/globals';

import { ansiLines, stripControlChars } from '../ansiLines';

describe('ansiLines', () => {
  it('splits lines and carries basic SGR styles across segments', () => {
    expect(
      ansiLines(
        '\x1b[34m╭─\x1b[39m plain\n\x1b[2m11:00\x1b[22m \x1b[91m●\x1b[0m api',
      ),
    ).toEqual([
      [{ text: '╭─', color: 'blue' }, { text: ' plain' }],
      [
        { text: '11:00', dim: true },
        { text: ' ' },
        { text: '●', color: 'redBright' },
        { text: ' api' },
      ],
    ]);
  });

  it('keeps empty lines so the chart keeps its height', () => {
    expect(ansiLines('a\n\nb')).toEqual([[{ text: 'a' }], [], [{ text: 'b' }]]);
  });

  it('drops escape sequences that are not colour codes', () => {
    const osc = `\x1b]0;pwned\x07`;
    expect(ansiLines(`\x1b[34mapi${osc}\x1b[39m \x1b[2Jdone`)).toEqual([
      [{ text: 'api]0;pwned', color: 'blue' }, { text: ' [2Jdone' }],
    ]);
  });

  it('drops C1 controls, DEL and bidi overrides but keeps printable Unicode', () => {
    expect(stripControlChars('a\u009b2Jb\u007fc\u202eé ● 😀')).toBe(
      'a2Jbcé ● 😀',
    );
  });
});
