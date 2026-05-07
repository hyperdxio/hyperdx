import { copyTextToClipboard, copyTextWithToast } from '../clipboard';

const mantineShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  notifications: {
    show: (...args: any[]) => mantineShow(...args),
  },
}));

const FAILURE_MESSAGE =
  "Couldn't copy to clipboard. If you're on plain HTTP, switch to HTTPS or localhost.";

function setSecureContext(secure: boolean) {
  Object.defineProperty(window, 'isSecureContext', {
    value: secure,
    writable: true,
    configurable: true,
  });
}

describe('copyTextToClipboard', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    mantineShow.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    setSecureContext(true);
    document.execCommand = jest.fn().mockReturnValue(true);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('uses navigator.clipboard when secure-context with the API', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const execSpy = document.execCommand as jest.Mock;

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execSpy).not.toHaveBeenCalled();
  });

  it('routes straight to execCommand when isSecureContext is false (preserves user activation)', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    // Even though writeText exists, a non-secure-context page should not
    // burn the click activation on an awaited modern attempt.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    setSecureContext(false);
    const execSpy = document.execCommand as jest.Mock;

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = jest
      .fn()
      .mockRejectedValue(new Error('permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const execSpy = document.execCommand as jest.Mock;

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(execSpy).toHaveBeenCalledWith('copy');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('writeText failed'),
      expect.any(Error),
    );
  });

  it('falls back to execCommand when navigator.clipboard is undefined', async () => {
    const execSpy = document.execCommand as jest.Mock;

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(execSpy).toHaveBeenCalledWith('copy');
  });

  it('returns false when both paths fail', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    document.execCommand = jest.fn().mockReturnValue(false);

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(false);
  });

  it('removes the textarea from the DOM after the fallback runs', async () => {
    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(document.querySelectorAll('textarea').length).toBe(0);
  });

  it('removes the textarea even when execCommand throws', async () => {
    document.execCommand = jest.fn().mockImplementation(() => {
      throw new Error('boom');
    });

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(false);
    expect(document.querySelectorAll('textarea').length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('execCommand fallback failed'),
      expect.any(Error),
    );
  });

  it('restores the existing selection after the fallback runs', async () => {
    const p = document.createElement('p');
    p.textContent = 'preserved selection target';
    document.body.appendChild(p);

    const range = document.createRange();
    range.selectNodeContents(p);

    const selection = document.getSelection();
    if (!selection) {
      throw new Error('jsdom should provide getSelection');
    }
    selection.removeAllRanges();
    selection.addRange(range);

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(selection.rangeCount).toBe(1);
    expect(selection.getRangeAt(0).toString()).toBe(
      'preserved selection target',
    );

    document.body.removeChild(p);
  });

  it('restores the previously focused element after the fallback runs', async () => {
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    const result = await copyTextToClipboard('hello');

    expect(result).toBe(true);
    expect(document.activeElement).toBe(input);

    document.body.removeChild(input);
  });

  it('refuses to fall back for payloads larger than the size cap', async () => {
    const big = 'x'.repeat(1_000_001);
    const execSpy = document.execCommand as jest.Mock;

    const result = await copyTextToClipboard(big);

    expect(result).toBe(false);
    expect(execSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('fallback refused'),
    );
  });

  it('still uses the modern API for large payloads when available', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const big = 'x'.repeat(1_000_001);

    const result = await copyTextToClipboard(big);

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith(big);
  });

  it('handles empty-string input correctly', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const result = await copyTextToClipboard('');

    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith('');
  });
});

describe('copyTextWithToast', () => {
  beforeEach(() => {
    mantineShow.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    setSecureContext(true);
    document.execCommand = jest.fn().mockReturnValue(true);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a green success toast on success', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const result = await copyTextWithToast('hello');

    expect(result).toBe(true);
    expect(mantineShow).toHaveBeenCalledWith({
      color: 'green',
      message: 'Copied to clipboard',
    });
  });

  it('uses a custom success message when provided', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    await copyTextWithToast('hello', 'Value copied to clipboard');

    expect(mantineShow).toHaveBeenCalledWith({
      color: 'green',
      message: 'Value copied to clipboard',
    });
  });

  it('shows a red failure toast when both paths fail', async () => {
    document.execCommand = jest.fn().mockReturnValue(false);

    const result = await copyTextWithToast('hello');

    expect(result).toBe(false);
    expect(mantineShow).toHaveBeenCalledWith({
      color: 'red',
      message: FAILURE_MESSAGE,
    });
  });

  it('shows a red failure toast for oversized payloads on non-secure contexts', async () => {
    setSecureContext(false);
    const big = 'x'.repeat(1_000_001);

    const result = await copyTextWithToast(big);

    expect(result).toBe(false);
    expect(mantineShow).toHaveBeenCalledWith({
      color: 'red',
      message: FAILURE_MESSAGE,
    });
  });
});
