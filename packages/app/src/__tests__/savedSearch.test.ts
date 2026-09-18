jest.mock('../api', () => ({
  __esModule: true,
  default: {},
  hdxServer: jest.fn(),
  useInvalidateTags: () => jest.fn(),
}));
jest.mock('../config', () => ({
  IS_LOCAL_MODE: true,
  HDX_LOCAL_DEFAULT_SOURCES: null,
}));

import { getLocalSavedSearchTags } from '@/savedSearch';

const STORAGE_KEY = 'hdx-local-saved-searches';

beforeEach(() => {
  localStorage.clear();
});

describe('getLocalSavedSearchTags', () => {
  it('returns empty array when no saved searches exist', () => {
    expect(getLocalSavedSearchTags()).toEqual([]);
  });

  it('collects and deduplicates tags across saved searches', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'a', name: 'A', tags: ['production', 'infra'] },
        { id: 'b', name: 'B', tags: ['production'] },
        { id: 'c', name: 'C' },
      ]),
    );
    const tags = getLocalSavedSearchTags();
    expect(tags).toHaveLength(2);
    expect(tags).toEqual(expect.arrayContaining(['production', 'infra']));
  });
});
