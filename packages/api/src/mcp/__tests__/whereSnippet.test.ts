jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({}));

import { buildWhereSnippet } from '@/mcp/tools/query/runEventPatterns';

describe('buildWhereSnippet', () => {
  it('drops bare <*> tokens and tokens with a mask inside', () => {
    expect(buildWhereSnippet('[<*>] "GET /health" 200', 'Body')).toBe(
      'Body:"\\"GET /health\\" 200"',
    );
    expect(
      buildWhereSnippet(
        'task finished run_id=scheduled__<*> trace_id=<*> in <*> ms',
        'Body',
      ),
    ).toBe('Body:"task finished in ms"');
  });

  it('returns an empty snippet when no literal token is left', () => {
    expect(buildWhereSnippet('<*> [<*>]', 'Body')).toBe('');
  });
});
