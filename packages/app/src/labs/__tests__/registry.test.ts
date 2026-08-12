import { LabIdSchema, LABS_MAX_KEYS } from '@hyperdx/common-utils/dist/types';

import { LABS } from '@/labs/registry';

/**
 * The server bounds the *shape* of what a user can store but deliberately does
 * not know the lab id list, so it cannot reject a typo'd id — see the Labs
 * comment in common-utils/src/types.ts. These assertions are what catch
 * `my_lab` or `My-Lab` at CI time instead of as a mystery 400 in the browser.
 *
 * They pass trivially while the registry is empty and start earning their keep
 * with the first lab.
 */
describe('labs registry', () => {
  it('gives every lab an id the API will accept', () => {
    for (const lab of LABS) {
      const result = LabIdSchema.safeParse(lab.id);
      expect(result.success).toBe(true);
    }
  });

  it('has no duplicate ids', () => {
    const ids = LABS.map(lab => lab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays within the per-user storage cap', () => {
    // Every lab in the registry can be enabled at once, so the registry itself
    // must fit inside what UserLabsSchema will accept.
    expect(LABS.length).toBeLessThanOrEqual(LABS_MAX_KEYS);
  });

  it('describes every lab well enough to opt into', () => {
    for (const lab of LABS) {
      expect(lab.title.trim()).not.toBe('');
      expect(lab.description.trim()).not.toBe('');
      expect(lab.owner.trim()).not.toBe('');
      // addedAt drives the graduate-or-retire sweep; see agent_docs/labs.md.
      expect(lab.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
