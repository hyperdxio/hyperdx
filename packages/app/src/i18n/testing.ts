import i18n from '@/i18n';
import { koResources } from '@/i18n/locales/ko';

export type KoreanNamespace = keyof typeof koResources;

/**
 * Snapshot of the shipped Korean catalog, taken before any test mutates it.
 *
 * i18next stores the resource objects passed at init by reference, so
 * `removeResourceBundle('ko', ns)` deletes the property from `koResources`
 * itself. Cloning up front keeps a pristine copy to restore from.
 */
const shippedKoreanCatalog = structuredClone(koResources) as Record<
  string,
  object
>;

/**
 * Replace the Korean bundle for `namespace` with only the entries under test.
 *
 * Localization tests assert two things: a reviewed Korean entry is consumed,
 * and a key without one falls back to English. Both must hold regardless of
 * how much of the real Korean catalog has been reviewed, so the test drives a
 * bundle it fully controls instead of the shipped one.
 *
 * `entries` is keyed by flat catalog path, e.g. `{ 'list.emptyTitle': '...' }`.
 */
export function setKoreanFixture(
  namespace: KoreanNamespace,
  entries: Record<string, string>,
): void {
  i18n.removeResourceBundle('ko', namespace);
  i18n.addResourceBundle('ko', namespace, {});

  for (const [key, value] of Object.entries(entries)) {
    i18n.addResource('ko', namespace, key, value);
  }
}

/** Restore the shipped Korean bundle replaced by {@link setKoreanFixture}. */
export function restoreKoreanCatalog(namespace: KoreanNamespace): void {
  i18n.removeResourceBundle('ko', namespace);
  i18n.addResourceBundle(
    'ko',
    namespace,
    structuredClone(shippedKoreanCatalog[namespace]),
    true,
    true,
  );
}
