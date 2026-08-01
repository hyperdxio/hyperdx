import { classifyFormEdit } from '@/components/DBEditTimeChartForm/useBuilderToSqlConversion';

describe('classifyFormEdit', () => {
  it('classifies a SQL editor change in SQL mode as a SQL edit', () => {
    expect(
      classifyFormEdit({
        name: 'sqlTemplate',
        type: 'change',
        configType: 'sql',
      }),
    ).toBe('sql');
  });

  it('classifies a builder query change in builder mode as a builder edit', () => {
    expect(
      classifyFormEdit({
        name: 'series.0.aggFn',
        type: 'change',
        configType: 'builder',
      }),
    ).toBe('builder');
    expect(
      classifyFormEdit({
        name: 'where',
        type: 'change',
        configType: 'builder',
      }),
    ).toBe('builder');
    expect(
      classifyFormEdit({
        name: 'source',
        type: 'change',
        configType: 'builder',
      }),
    ).toBe('builder');
  });

  it('ignores programmatic changes (undefined type)', () => {
    // Mode-switch field resets and our own generated-SQL write arrive without a
    // 'change' type, so they must never be counted as user edits.
    expect(
      classifyFormEdit({
        name: 'sqlTemplate',
        type: undefined,
        configType: 'sql',
      }),
    ).toBeNull();
    expect(
      classifyFormEdit({
        name: 'select',
        type: undefined,
        configType: 'builder',
      }),
    ).toBeNull();
  });

  it('ignores mode-agnostic fields (chart name, configType toggle)', () => {
    expect(
      classifyFormEdit({ name: 'name', type: 'change', configType: 'builder' }),
    ).toBeNull();
    expect(
      classifyFormEdit({ name: 'name', type: 'change', configType: 'sql' }),
    ).toBeNull();
    expect(
      classifyFormEdit({
        name: 'configType',
        type: 'change',
        configType: 'sql',
      }),
    ).toBeNull();
  });

  it('does not count a builder field change while in SQL mode', () => {
    // e.g. the source select is present in both modes; changing it in SQL mode
    // is not a builder edit.
    expect(
      classifyFormEdit({ name: 'source', type: 'change', configType: 'sql' }),
    ).toBeNull();
  });

  it('does not count a SQL editor change while in builder mode', () => {
    expect(
      classifyFormEdit({
        name: 'sqlTemplate',
        type: 'change',
        configType: 'builder',
      }),
    ).toBeNull();
  });

  it('ignores changes with no field name', () => {
    expect(
      classifyFormEdit({ name: undefined, type: 'change', configType: 'sql' }),
    ).toBeNull();
  });
});
