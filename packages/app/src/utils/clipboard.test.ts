import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    document.execCommand = originalExecCommand;
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('uses the Clipboard API when it is available', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await expect(copyTextToClipboard('hello')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to a textarea copy when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn().mockReturnValue(true);

    await expect(copyTextToClipboard('fallback text')).resolves.toBe(true);

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('does not fall back when the Clipboard API rejects', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    document.execCommand = jest.fn().mockReturnValue(true);

    await expect(copyTextToClipboard('blocked')).resolves.toBe(false);

    expect(writeText).toHaveBeenCalledWith('blocked');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('removes the fallback textarea when execCommand throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn(() => {
      throw new Error('copy failed');
    });

    await expect(copyTextToClipboard('throwing copy')).resolves.toBe(false);

    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports failure when both copy methods are unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn().mockReturnValue(false);

    await expect(copyTextToClipboard('nope')).resolves.toBe(false);
  });
});
