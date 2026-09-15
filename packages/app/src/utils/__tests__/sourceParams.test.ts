import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  resolveSourceParam,
  resolveSourcesParam,
  SourceForParamResolution,
} from '@/utils/sourceParams';

const LOGS_1 = { id: 'log-1', name: 'Logs', kind: SourceKind.Log };
const LOGS_2 = { id: 'log-2', name: 'Logs', kind: SourceKind.Log };
const TRACES = { id: 'trace-1', name: 'Traces', kind: SourceKind.Trace };
const OLD_LOGS_DISABLED = {
  id: 'log-3',
  name: 'Old Logs',
  kind: SourceKind.Log,
  disabled: true,
};
// A source whose *ID* collides with another source's name.
const DECOY = { id: 'Logs', name: 'Decoy', kind: SourceKind.Log };

const SOURCES: SourceForParamResolution[] = [
  LOGS_1,
  TRACES,
  OLD_LOGS_DISABLED,
  DECOY,
];

describe('resolveSourceParam', () => {
  it('reports an empty param', () => {
    expect(resolveSourceParam(null, SOURCES)).toEqual({ status: 'empty' });
    expect(resolveSourceParam(undefined, SOURCES)).toEqual({ status: 'empty' });
    expect(resolveSourceParam('', SOURCES)).toEqual({ status: 'empty' });
  });

  it('reports pending while sources are loading', () => {
    expect(resolveSourceParam('Logs', undefined)).toEqual({
      status: 'pending',
    });
  });

  it('resolves an exact ID match', () => {
    expect(resolveSourceParam('log-1', SOURCES)).toEqual({
      status: 'resolved',
      source: LOGS_1,
    });
  });

  it('prefers an ID match over a source of the same kind with that name', () => {
    // 'Logs' is both DECOY's ID and LOGS_1's name — the ID wins.
    expect(resolveSourceParam('Logs', SOURCES)).toEqual({
      status: 'resolved',
      source: DECOY,
    });
  });

  it('ignores a wrong-kind ID entirely, so a usable name still resolves', () => {
    // The param is a trace source's ID *and* a log source's name; on a log-only
    // page the trace source is filtered out before matching.
    const sources = [
      { id: 'Shared', name: 'Traces', kind: SourceKind.Trace },
      { id: 'log-9', name: 'Shared', kind: SourceKind.Log },
    ];
    expect(
      resolveSourceParam('Shared', sources, { kinds: [SourceKind.Log] }),
    ).toEqual({ status: 'resolved', source: sources[1] });
  });

  it('reports a wrong-kind ID along with the source it found', () => {
    // The caller needs the source to say "that's a trace source", and the
    // status keeps it out of the resolved path.
    expect(
      resolveSourceParam('trace-1', SOURCES, { kinds: [SourceKind.Log] }),
    ).toEqual({ status: 'wrong-kind', source: TRACES });
  });

  it('resolves an exact-case name to its source', () => {
    expect(resolveSourceParam('Traces', SOURCES)).toEqual({
      status: 'resolved',
      source: TRACES,
    });
  });

  it('prefers the requested kind, and reports a wrong-kind name match', () => {
    expect(
      resolveSourceParam('Traces', SOURCES, { kinds: [SourceKind.Trace] }),
    ).toEqual({
      status: 'resolved',
      source: TRACES,
    });

    // A name that can only mean a source of another kind reports which source
    // it found, rather than pretending nothing matches.
    expect(
      resolveSourceParam('Traces', SOURCES, { kinds: [SourceKind.Log] }),
    ).toEqual({ status: 'wrong-kind', source: TRACES });
  });

  it('resolves a name shared across kinds to the requested kind', () => {
    const logsAndMetrics = [
      { id: 'metric-1', name: 'Kubernetes', kind: SourceKind.Metric },
      { id: 'log-9', name: 'Kubernetes', kind: SourceKind.Log },
    ];
    expect(
      resolveSourceParam('Kubernetes', logsAndMetrics, {
        kinds: [SourceKind.Log],
      }),
    ).toEqual({
      status: 'resolved',
      source: logsAndMetrics[1],
    });
  });

  it('falls back to a case-insensitive name match', () => {
    expect(resolveSourceParam('traces', SOURCES)).toEqual({
      status: 'resolved',
      source: TRACES,
    });
  });

  it('prefers an exact-case match over a case-insensitive one', () => {
    const sources = [
      { id: 'log-lower', name: 'logs', kind: SourceKind.Log },
      LOGS_1,
    ];
    expect(resolveSourceParam('Logs', sources)).toEqual({
      status: 'resolved',
      source: LOGS_1,
    });
  });

  it('reports an unknown param as not found', () => {
    expect(resolveSourceParam('nope', SOURCES)).toEqual({
      status: 'not-found',
    });
  });

  it('picks the lowest ID and reports ambiguity for duplicate names', () => {
    expect(resolveSourceParam('Logs', [LOGS_1, LOGS_2, TRACES])).toEqual({
      status: 'resolved',
      source: LOGS_1,
      ambiguousMatchCount: 2,
    });
  });

  it('picks the same source for an ambiguous name whatever order sources arrive in', () => {
    // The API gives no ordering guarantee, so the pick can't depend on it.
    const forwards = resolveSourceParam('Logs', [LOGS_1, LOGS_2]);
    const backwards = resolveSourceParam('Logs', [LOGS_2, LOGS_1]);
    expect(backwards).toEqual(forwards);
    expect(backwards).toEqual({
      status: 'resolved',
      source: LOGS_1,
      ambiguousMatchCount: 2,
    });
  });

  it('does not reorder the array it was given', () => {
    const sources = [LOGS_2, LOGS_1];
    resolveSourceParam('Logs', sources);
    expect(sources).toEqual([LOGS_2, LOGS_1]);
  });

  it('prefers an enabled source over a disabled one without flagging ambiguity', () => {
    const sources = [{ ...LOGS_2, disabled: true }, LOGS_1];
    expect(resolveSourceParam('Logs', sources)).toEqual({
      status: 'resolved',
      source: LOGS_1,
    });
  });

  it('resolves a name matching only disabled sources', () => {
    expect(resolveSourceParam('Old Logs', SOURCES)).toEqual({
      status: 'resolved',
      source: OLD_LOGS_DISABLED,
    });
  });
});

describe('resolveSourcesParam', () => {
  it('resolves a list by ID and by name', () => {
    expect(resolveSourcesParam(['log-1', 'Traces'], SOURCES)).toEqual({
      status: 'resolved',
      sources: [LOGS_1, TRACES],
      unresolved: [],
    });
  });

  it('reports pending while sources are loading', () => {
    expect(resolveSourcesParam(['log-1'], undefined)).toEqual({
      status: 'pending',
    });
  });

  it('resolves an empty selection without waiting on the source list', () => {
    expect(resolveSourcesParam([], undefined)).toEqual({
      status: 'resolved',
      sources: [],
      unresolved: [],
    });
  });

  it('keeps what resolves and reports the rest, so one bad entry does not sink the selection', () => {
    expect(resolveSourcesParam(['log-1', 'Nope', 'Traces'], SOURCES)).toEqual({
      status: 'resolved',
      sources: [LOGS_1, TRACES],
      unresolved: ['Nope'],
    });
  });

  it('reports an entry naming a source of the wrong kind', () => {
    expect(
      resolveSourcesParam(['log-1', 'Traces'], SOURCES, {
        kinds: [SourceKind.Log],
      }),
    ).toEqual({
      status: 'resolved',
      sources: [LOGS_1],
      unresolved: ['Traces'],
    });
  });

  it('dedupes entries that resolve to the same source', () => {
    expect(resolveSourcesParam(['log-1', 'log-1'], SOURCES)).toEqual({
      status: 'resolved',
      sources: [LOGS_1],
      unresolved: [],
    });
  });

  it('caps the selection at `max`, keeping the first entries', () => {
    expect(
      resolveSourcesParam(['log-1', 'Traces', 'Old Logs'], SOURCES, { max: 2 }),
    ).toEqual({
      status: 'resolved',
      sources: [LOGS_1, TRACES],
      unresolved: [],
    });
  });
});
