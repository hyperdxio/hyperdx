import { keyPathsToArray } from '@/llm/lib/attributeUtils';

describe('keyPathsToArray', () => {
  it('reconstructs indexed objects with nested arrays', () => {
    expect(
      keyPathsToArray(
        {
          'msg.0.role': 'user',
          'msg.0.content': 'hi',
          'msg.1.role': 'assistant',
          'msg.1.tool_calls.0.name': 'search',
        },
        'msg',
      ),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', tool_calls: [{ name: 'search' }] },
    ]);
  });

  it('compacts sparse indices', () => {
    expect(
      keyPathsToArray(
        { 'msg.0.role': 'user', 'msg.5.role': 'assistant' },
        'msg',
      ),
    ).toEqual([{ role: 'user' }, { role: 'assistant' }]);
  });

  it('rejects oversized indices instead of materializing huge arrays', () => {
    // Attribute keys arrive verbatim from ingested telemetry; a huge index
    // would create a ~2e9-length sparse array whose filter/map iteration
    // freezes the tab (a hang here would trip Jest's test timeout).
    expect(
      keyPathsToArray(
        {
          'msg.2000000000.role': 'user',
          'msg.0.role': 'system',
          // Oversized nested index: the whole key is skipped, the rest of
          // the item survives.
          'msg.0.tool_calls.2000000000.name': 'evil',
          'msg.0.content': 'ok',
        },
        'msg',
      ),
    ).toEqual([{ role: 'system', content: 'ok' }]);
  });
});
