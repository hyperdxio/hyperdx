export type Segment = {
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
};

const BASE = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
];
// Built from a string so the ESC character isn't a literal control char in a regex.
const SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9;]*)m`, 'g');

function colorFor(code: number): string | undefined {
  if (code >= 30 && code <= 37) return BASE[code - 30];
  if (code >= 90 && code <= 97)
    return code === 90 ? 'gray' : `${BASE[code - 90]}Bright`;
  return undefined;
}

// Chart text carries user data (service names, log fields). Keep it from controlling
// the terminal (C0/C1 controls) or reordering what is shown (bidi overrides).
export function stripControlChars(text: string): string {
  return [...text]
    .filter(c => {
      const code = c.codePointAt(0)!;
      const isControl = code < 0x20 || (code >= 0x7f && code < 0xa0);
      const isBidi =
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069);
      return !isControl && !isBidi;
    })
    .join('');
}

/**
 * Splits termchart's output into styled segments per line. termchart runs at
 * chalk level 1 here, so only basic SGR codes need handling.
 */
export function ansiLines(ansi: string): Segment[][] {
  let style: Omit<Segment, 'text'> = {};
  return ansi.split('\n').map(line => {
    const segments: Segment[] = [];
    let last = 0;
    const push = (raw: string) => {
      const text = stripControlChars(raw);
      if (text) segments.push({ text, ...style });
    };
    for (const match of line.matchAll(SGR)) {
      push(line.slice(last, match.index));
      last = match.index + match[0].length;
      for (const code of (match[1] || '0').split(';').map(Number)) {
        if (code === 0) style = {};
        else if (code === 1) style = { ...style, bold: true };
        else if (code === 2) style = { ...style, dim: true };
        else if (code === 22)
          style = { ...style, bold: undefined, dim: undefined };
        else if (code === 39) style = { ...style, color: undefined };
        else if (colorFor(code)) style = { ...style, color: colorFor(code) };
      }
    }
    push(line.slice(last));
    return segments;
  });
}
