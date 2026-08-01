import { parseResourceAttributes } from '@/config';

describe('parseResourceAttributes', () => {
  it('parses a standard comma-separated string', () => {
    const raw =
      'service.namespace=observability,deployment.environment=prod,k8s.cluster.name=us-west-2';
    expect(parseResourceAttributes(raw)).toEqual({
      'service.namespace': 'observability',
      'deployment.environment': 'prod',
      'k8s.cluster.name': 'us-west-2',
    });
  });

  it('returns an empty object for an empty string', () => {
    expect(parseResourceAttributes('')).toEqual({});
  });

  it('handles a single key=value pair', () => {
    expect(parseResourceAttributes('foo=bar')).toEqual({ foo: 'bar' });
  });

  it('handles values containing equals signs', () => {
    expect(parseResourceAttributes('url=https://example.com?a=1')).toEqual({
      url: 'https://example.com?a=1',
    });
  });

  it('skips malformed entries without an equals sign', () => {
    expect(parseResourceAttributes('good=value,badentry,ok=yes')).toEqual({
      good: 'value',
      ok: 'yes',
    });
  });

  it('skips entries where key is empty (leading equals)', () => {
    expect(parseResourceAttributes('=nokey,valid=value')).toEqual({
      valid: 'value',
    });
  });

  it('handles trailing commas gracefully', () => {
    expect(parseResourceAttributes('a=1,b=2,')).toEqual({ a: '1', b: '2' });
  });

  it('handles leading commas gracefully', () => {
    expect(parseResourceAttributes(',a=1,b=2')).toEqual({ a: '1', b: '2' });
  });

  it('allows empty values', () => {
    expect(parseResourceAttributes('key=')).toEqual({ key: '' });
  });

  it('last value wins for duplicate keys', () => {
    expect(parseResourceAttributes('k=first,k=second')).toEqual({
      k: 'second',
    });
  });

  it('decodes percent-encoded commas in values', () => {
    expect(parseResourceAttributes('tags=a%2Cb%2Cc')).toEqual({
      tags: 'a,b,c',
    });
  });

  it('decodes percent-encoded equals in values', () => {
    expect(parseResourceAttributes('expr=x%3D1')).toEqual({
      expr: 'x=1',
    });
  });

  it('decodes percent-encoded keys', () => {
    expect(parseResourceAttributes('my%2Ekey=value')).toEqual({
      'my.key': 'value',
    });
  });

  it('round-trips values with both encoded commas and equals', () => {
    expect(parseResourceAttributes('q=a%3D1%2Cb%3D2,other=plain')).toEqual({
      q: 'a=1,b=2',
      other: 'plain',
    });
  });
});
