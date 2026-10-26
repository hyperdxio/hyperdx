import {
  familyTable,
  mechanismLabels,
  misleadingIncidents,
  relatedIncidents,
} from '@/scenarios/smokehouse/families';
import { INCIDENTS } from '@/scenarios/smokehouse/generator/incidents';
import { GROUND_TRUTH } from '@/scenarios/smokehouse/groundTruth';

const names = Object.keys(INCIDENTS);
const gt = (n: string) => GROUND_TRUTH[n];
const origin = (n: string) => gt(n).expected.originService;

describe('incident families', () => {
  it('never uses none_of_these as a label', () => {
    for (const n of names) {
      expect(mechanismLabels(gt(n)).has('none_of_these')).toBe(false);
    }
  });

  it('related incidents share a label, differ in origin, exclude self', () => {
    for (const n of names) {
      const mine = mechanismLabels(gt(n));
      for (const r of relatedIncidents(n)) {
        expect(r).not.toBe(n);
        expect(origin(r)).not.toBe(origin(n));
        expect([...mechanismLabels(gt(r))].some(l => mine.has(l))).toBe(true);
      }
    }
  });

  it('misleading incidents share origin, share no label, exclude self', () => {
    for (const n of names) {
      const mine = mechanismLabels(gt(n));
      for (const m of misleadingIncidents(n)) {
        expect(m).not.toBe(n);
        expect(origin(m)).toBe(origin(n));
        expect([...mechanismLabels(gt(m))].some(l => mine.has(l))).toBe(false);
      }
    }
  });

  it('is sorted and covers every incident', () => {
    const table = familyTable();
    expect(table.map(r => r.name)).toEqual(names.slice().sort());
    for (const r of table) expect(r.related).toEqual([...r.related].sort());
  });

  it('gives at least 20 incidents a related incident', () => {
    const count = names.filter(n => relatedIncidents(n).length > 0).length;
    console.log(`incidents with related: ${count} of ${names.length}`);
    expect(count).toBeGreaterThanOrEqual(20);
  });
});
