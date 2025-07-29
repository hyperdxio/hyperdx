import { getDefaultSourceId } from '../../DBSearchPage';

describe('getDefaultSourceId', () => {
  it('returns empty string if sources is undefined', () => {
    expect(getDefaultSourceId(undefined, undefined)).toBe('');
  });

  it('returns empty string if sources is empty', () => {
    expect(getDefaultSourceId([], undefined)).toBe('');
  });

  it('returns lastSelectedSourceId if it exists in sources', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(getDefaultSourceId(sources, 'b')).toBe('b');
  });

  it('returns first source id if lastSelectedSourceId is not in sources', () => {
    const sources = [{ id: 'a' }, { id: 'b' }];
    expect(getDefaultSourceId(sources, 'z')).toBe('a');
  });

  it('returns first source id if lastSelectedSourceId is undefined', () => {
    const sources = [{ id: 'x' }, { id: 'y' }];
    expect(getDefaultSourceId(sources, undefined)).toBe('x');
  });
});
