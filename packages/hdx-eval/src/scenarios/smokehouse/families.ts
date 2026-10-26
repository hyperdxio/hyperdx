import { INCIDENTS } from './generator/incidents';
import { SERVICES } from './generator/topology';
import { GROUND_TRUTH } from './groundTruth';
import type { SmokehouseGroundTruth } from './scenario';

const IGNORED_MECHANISMS = ['none_of_these'];

// Names here are bare incident names (no `sh-` prefix), matching INCIDENTS.
// "Differ in origin" uses originService only: trigger is not a structured field.
type Family = {
  name: string;
  origin: string;
  labels: string[];
  related: string[];
  misleading: string[];
};

export function mechanismLabels(gt: SmokehouseGroundTruth): Set<string> {
  const e = gt.expected;
  const skip = new Set(
    [...SERVICES, e.originService, e.affectedService, e.userFacingService]
      .filter((s): s is string => !!s)
      .map(s => s.toLowerCase()),
  );
  const out = new Set<string>();
  for (const label of Object.values(gt.mechanisms ?? {}).flat()) {
    if (IGNORED_MECHANISMS.includes(label) || skip.has(label.toLowerCase())) {
      continue;
    }
    out.add(label);
  }
  return out;
}

const names = Object.keys(INCIDENTS).sort();
const info = Object.fromEntries(
  names.map(n => [
    n,
    {
      origin: GROUND_TRUTH[n].expected.originService,
      labels: mechanismLabels(GROUND_TRUTH[n]),
    },
  ]),
);
const shares = (a: string, b: string) =>
  [...info[a].labels].some(l => info[b].labels.has(l));

export function relatedIncidents(name: string): string[] {
  return names.filter(
    n => n !== name && info[n].origin !== info[name].origin && shares(name, n),
  );
}

export function misleadingIncidents(name: string): string[] {
  return names.filter(
    n => n !== name && info[n].origin === info[name].origin && !shares(name, n),
  );
}

export function familyTable(): Family[] {
  return names.map(name => ({
    name,
    origin: info[name].origin,
    labels: [...info[name].labels].sort(),
    related: relatedIncidents(name),
    misleading: misleadingIncidents(name),
  }));
}
