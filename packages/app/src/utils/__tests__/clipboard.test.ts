import { copyTextToClipboard, copyTextWithToast } from '../clipboard';

const mantineShow = jest.fn();
jest.mock('@mantine/notifications', () => ({
  notifications: {
    show: (...args: any[]) => mantineShow(...args),
  },
}));

describe('copyTextToClipboard', () => {
  beforeEach(() => {
    mantineShow.mockClear();
    // Reset clipboard between tests
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    // Default execCommand stub returns true
    document.execCommand = jest.fn().mockReturnValue(true);
  });

  it('uses navigator.clipboard when available', async () => {
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

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
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
  });

  it('falls back to execCommand when navigator.clipboard is undefined', async () => {
    // clipboard is undefined per beforeEach
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
  });

  it('restores the existing selection after the fallback runs', async () => {
    // Seed an existing range on a paragraph in the DOM
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
});

describe('copyTextWithToast', () => {
  beforeEach(() => {
    mantineShow.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    document.execCommand = jest.fn().mockReturnValue(true);
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
      message:
        "Couldn't copy. HyperDX needs HTTPS or localhost to use the browser clipboard API.",
    });
  });
});
