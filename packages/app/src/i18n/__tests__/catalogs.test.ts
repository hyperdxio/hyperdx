import { enResources } from '@/i18n/locales/en';
import { koResources } from '@/i18n/locales/ko';

type LeafMap = Map<string, string>;

const flattenLeaves = (resource: unknown): LeafMap => {
  const leaves = new Map<string, string>();

  const visit = (value: unknown, prefix: string) => {
    if (typeof value === 'string') {
      leaves.set(prefix, value);
      return;
    }

    if (value != null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        visit(child, prefix ? `${prefix}.${key}` : key);
      }
    }
  };

  visit(resource, '');

  return leaves;
};

const placeholderNames = (value: string): string[] =>
  [
    ...new Set(
      [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(([, placeholder]) =>
        placeholder.trim().replace(/^-\s*/, '').split(',')[0].trim(),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));

const findUnknownKoreanKeys = (english: LeafMap, korean: LeafMap): string[] =>
  [...korean.keys()]
    .filter(key => !english.has(key))
    .sort((a, b) => a.localeCompare(b));

const findPlaceholderMismatches = (
  english: LeafMap,
  korean: LeafMap,
): string[] =>
  [...korean.keys()]
    .filter(key => {
      const englishValue = english.get(key);
      const koreanValue = korean.get(key);

      return (
        englishValue != null &&
        koreanValue != null &&
        placeholderNames(englishValue).join(',') !==
          placeholderNames(koreanValue).join(',')
      );
    })
    .sort((a, b) => a.localeCompare(b));

describe('translation catalog integrity', () => {
  const english = flattenLeaves(enResources);
  const korean = flattenLeaves(koResources);

  it('has English source strings', () => {
    expect(english.size).toBeGreaterThan(0);
  });

  it('only contains Korean keys that exist in English', () => {
    expect(findUnknownKoreanKeys(english, korean)).toEqual([]);
  });

  it('keeps Korean interpolation placeholders aligned with English', () => {
    expect(findPlaceholderMismatches(english, korean)).toEqual([]);
  });

  it('detects a test-local unknown Korean key', () => {
    expect(
      findUnknownKoreanKeys(
        new Map([['common.save', 'Save']]),
        new Map([['common.unknown', '알 수 없음']]),
      ),
    ).toEqual(['common.unknown']);
  });

  it('detects a test-local placeholder mismatch', () => {
    expect(
      findPlaceholderMismatches(
        new Map([['common.greeting', 'Hello, {{ name }}!']]),
        new Map([['common.greeting', '안녕하세요, {{user}}!']]),
      ),
    ).toEqual(['common.greeting']);
  });
});
