import { csvExportFilename, toCsvString } from '@/utils/csv';

describe('toCsvString', () => {
  it('writes a header row from the object keys', () => {
    expect(toCsvString([{ level: 'error', count: 2 }])).toBe(
      '"level","count"\r\n"error","2"',
    );
  });

  it('quotes and escapes commas, quotes and newlines', () => {
    const csv = toCsvString([
      { body: 'a,b', quoted: 'say "hi"', multi: 'one\ntwo' },
    ]);

    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
    expect(csv).toContain('"one\ntwo"');
  });

  it('returns an empty string for no rows', () => {
    expect(toCsvString([])).toBe('');
  });

  it('does not prepend a BOM — that belongs to the download path only', () => {
    expect(toCsvString([{ a: 1 }]).charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('csvExportFilename', () => {
  it('returns a timestamped name with no extension', () => {
    const filename = csvExportFilename('hyperdx_selected_rows');

    expect(filename).not.toMatch(/\.csv$/);
    expect(filename).toMatch(
      /^hyperdx_selected_rows_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/,
    );
  });
});
