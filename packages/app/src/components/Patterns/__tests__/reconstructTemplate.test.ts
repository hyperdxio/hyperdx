import { reconstructTemplate } from '@/components/Patterns/reconstructTemplate';

describe('reconstructTemplate', () => {
  it('returns the original log when the template is empty', () => {
    expect(reconstructTemplate('hello world', '')).toBe('hello world');
  });

  it('restores JSON separators around stable and variable tokens', () => {
    expect(
      reconstructTemplate(
        `{"hostname":"foo","pid":12345,"time":1700000000}`,
        'hostname foo pid <*> time <*>',
      ),
    ).toBe(`{"hostname":"foo","pid":<*>,"time":<*>}`);
  });

  it('restores ClickHouse Map (single-quoted) separators', () => {
    expect(
      reconstructTemplate(
        `{'hostname':'Aarons-MacBook-Pro.local','pid':12345,'time':1700000000}`,
        'hostname Aarons MacBook Pro local pid <*> time <*>',
      ),
    ).toBe(`{'hostname':'Aarons-MacBook-Pro.local','pid':<*>,'time':<*>}`);
  });

  it('restores key=value separators', () => {
    expect(
      reconstructTemplate(
        'level=info msg=hello user_id=42',
        'level info msg hello user id <*>',
      ),
    ).toBe('level=info msg=hello user_id=<*>');
  });

  it('keeps the original token when the template runs short', () => {
    expect(reconstructTemplate('alpha beta gamma delta', 'alpha beta')).toBe(
      'alpha beta gamma delta',
    );
  });

  it('preserves leading and trailing separators', () => {
    expect(reconstructTemplate('[INFO] hello world', 'INFO hello world')).toBe(
      '[INFO] hello world',
    );
  });

  it('collapses newlines and tabs in the original log to single spaces', () => {
    expect(
      reconstructTemplate(
        'Error:\n  message: "failed"\n  code: 500',
        'Error message failed code <*>',
      ),
    ).toBe('Error: message: "failed" code: <*>');

    expect(reconstructTemplate('foo\n\n\nbar', 'foo bar')).toBe('foo bar');

    expect(reconstructTemplate('foo\tbar', 'foo bar')).toBe('foo bar');
  });
});
