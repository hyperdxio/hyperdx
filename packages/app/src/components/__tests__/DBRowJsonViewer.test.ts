import { migrateViewerOptions } from '../DBRowJsonViewer';

describe('migrateViewerOptions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null for null input', () => {
    expect(migrateViewerOptions(null)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(migrateViewerOptions('not json')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(migrateViewerOptions('"string"')).toBeNull();
    expect(migrateViewerOptions('42')).toBeNull();
    expect(migrateViewerOptions('null')).toBeNull();
  });

  it('migrates lineWrap: true (old default) to whiteSpace: undefined', () => {
    const old = JSON.stringify({
      normallyExpanded: true,
      lineWrap: true,
      tabulate: true,
      filterBlanks: false,
    });
    const result = migrateViewerOptions(old);
    expect(result).toEqual({
      normallyExpanded: true,
      whiteSpace: undefined,
      tabulate: true,
      filterBlanks: false,
    });
  });

  it('migrates lineWrap: false (user wanted wrapping) to whiteSpace: pre-wrap', () => {
    const old = JSON.stringify({
      normallyExpanded: true,
      lineWrap: false,
      tabulate: true,
      filterBlanks: false,
    });
    const result = migrateViewerOptions(old);
    expect(result).toEqual({
      normallyExpanded: true,
      whiteSpace: 'pre-wrap',
      tabulate: true,
      filterBlanks: false,
    });
  });

  it('writes migrated value back to localStorage', () => {
    const old = JSON.stringify({
      normallyExpanded: true,
      lineWrap: false,
      tabulate: true,
      filterBlanks: false,
    });
    localStorage.setItem('hdx_json_viewer_options', old);
    migrateViewerOptions(old);

    const stored = JSON.parse(localStorage.getItem('hdx_json_viewer_options')!);
    expect(stored.whiteSpace).toBe('pre-wrap');
    expect(stored).not.toHaveProperty('lineWrap');
  });

  it('passes through already-migrated options unchanged', () => {
    const current = JSON.stringify({
      normallyExpanded: true,
      whiteSpace: 'pre',
      tabulate: true,
      filterBlanks: false,
    });
    const result = migrateViewerOptions(current);
    expect(result).toEqual({
      normallyExpanded: true,
      whiteSpace: 'pre',
      tabulate: true,
      filterBlanks: false,
    });
  });

  it('passes through options with whiteSpace: pre-wrap unchanged', () => {
    const current = JSON.stringify({
      normallyExpanded: false,
      whiteSpace: 'pre-wrap',
      tabulate: false,
      filterBlanks: true,
    });
    const result = migrateViewerOptions(current);
    expect(result).toEqual({
      normallyExpanded: false,
      whiteSpace: 'pre-wrap',
      tabulate: false,
      filterBlanks: true,
    });
  });

  it('preserves other options during migration', () => {
    const old = JSON.stringify({
      normallyExpanded: false,
      lineWrap: true,
      tabulate: false,
      filterBlanks: true,
    });
    const result = migrateViewerOptions(old);
    expect(result?.normallyExpanded).toBe(false);
    expect(result?.tabulate).toBe(false);
    expect(result?.filterBlanks).toBe(true);
  });
});
