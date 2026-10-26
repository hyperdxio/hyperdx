import { negativeMatches, stepsToOrigin } from '@/grading/origin';
import type { ProgrammaticResult } from '@/grading/types';
import type { ToolCallRecord } from '@/harness/types';

const call = (input: unknown): ToolCallRecord => ({
  name: 't',
  input,
  output: null,
  isError: false,
  startedAt: '',
  endedAt: null,
  durationMs: null,
});

describe('stepsToOrigin', () => {
  it('returns the 1-based index of the first call naming the origin', () => {
    const calls = [
      call({ service: 'edge-gateway' }),
      call({ service: 'checkout' }),
      call({ service: 'cart' }),
    ];
    expect(stepsToOrigin(calls, 'cart', 'checkout')).toBe(3);
  });

  it('does not match the origin inside a longer hyphenated name', () => {
    expect(
      stepsToOrigin(
        [call({ q: 'cart-db' }), call({ q: 'my_cart' })],
        'cart',
        'x',
      ),
    ).toBeNull();
  });

  it('returns null when never named or when origin equals alerting', () => {
    expect(stepsToOrigin([call({ q: 'edge' })], 'cart', 'checkout')).toBeNull();
    expect(stepsToOrigin([call({ q: 'cart' })], 'cart', 'cart')).toBeNull();
  });

  it('skips knowledge recording calls when indexing', () => {
    const named = (name: string, input: unknown) => ({ ...call(input), name });
    const calls = [
      named('mcp__kg__clickstack_open_incident', { alertingService: 'cart' }),
      call({ service: 'edge' }),
      named('mcp__kg__clickstack_record_incident_action', { args: 'cart' }),
      named('clickstack_resolve_incident', { rootCauseNode: 'service:cart' }),
      call({ service: 'cart' }),
    ];
    expect(stepsToOrigin(calls, 'cart', 'edge')).toBe(2);
  });

  it('escapes regex characters in the origin', () => {
    expect(stepsToOrigin([call({ q: 'a.b' })], 'a.b', 'x')).toBe(1);
    expect(stepsToOrigin([call({ q: 'axb' })], 'a.b', 'x')).toBeNull();
  });
});

describe('negativeMatches', () => {
  it('counts negative hits that matched', () => {
    const programmatic: ProgrammaticResult = {
      score: 0,
      hits: [
        { id: 'a', weight: 1, matched: true, satisfied: false, negative: true },
        { id: 'b', weight: 1, matched: true, satisfied: false, negative: true },
        { id: 'c', weight: 1, matched: false, satisfied: true, negative: true },
        { id: 'd', weight: 1, matched: true, satisfied: true },
      ],
    };
    expect(negativeMatches(programmatic)).toBe(2);
  });
});
