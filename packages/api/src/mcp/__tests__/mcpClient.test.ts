import { userAgentClientInfo } from '@/mcp/utils/mcpClient';

describe('userAgentClientInfo', () => {
  it.each([
    ['Cursor/1.5.0 (darwin)', { name: 'cursor', version: '1.5.0' }],
    ['opencode/1.18.0', { name: 'opencode', version: '1.18.0' }],
    ['claude-code/2.1.185 (cli)', { name: 'claude-code', version: '2.1.185' }],
    ['node', { name: 'node', version: undefined }],
    ['Some Client 2.0', { name: 'some', version: undefined }],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
      { name: 'mozilla', version: '5.0' },
    ],
  ])('extracts client identity from %p', (raw, expected) => {
    expect(userAgentClientInfo(raw)).toEqual(expected);
  });

  it('returns an empty identity for a missing header', () => {
    expect(userAgentClientInfo(undefined)).toEqual({});
  });

  it('returns an empty identity for a blank/whitespace header', () => {
    expect(userAgentClientInfo('   ')).toEqual({});
  });

  it('returns an empty identity when the product name is missing', () => {
    expect(userAgentClientInfo('/1.0')).toEqual({});
  });

  it('caps name and version at 32 characters', () => {
    const clientInfo = userAgentClientInfo(
      `${'a'.repeat(50)}/${'1'.repeat(50)}`,
    );

    expect(clientInfo.name).toHaveLength(32);
    expect(clientInfo.version).toHaveLength(32);
  });
});
