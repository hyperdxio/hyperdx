import { copyTextToClipboard } from '@/utils/clipboard';

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
    const initialChildCount = document.body.childElementCount;

    await expect(copyTextToClipboard('fallback text')).resolves.toBe(true);

    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.childElementCount).toBe(initialChildCount);
  });

  it('falls back to a textarea copy when the Clipboard API rejects', async () => {
    const writeText = jest.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    document.execCommand = jest.fn().mockReturnValue(true);

    await expect(copyTextToClipboard('blocked')).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('blocked');
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('removes the fallback textarea when execCommand throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn(() => {
      throw new Error('copy failed');
    });
    const initialChildCount = document.body.childElementCount;

    await expect(copyTextToClipboard('throwing copy')).resolves.toBe(false);

    expect(document.body.childElementCount).toBe(initialChildCount);
  });

  it('restores the previous selection after the textarea fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn().mockReturnValue(true);
    const selectedText = document.createTextNode('selected text');
    const container = document.createElement('div');
    container.appendChild(selectedText);
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    await expect(copyTextToClipboard('copy text')).resolves.toBe(true);

    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).toString()).toBe('selected text');
  });

  it('still reports the copy result if selection restoration fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn().mockReturnValue(true);
    const selectedText = document.createTextNode('selected text');
    const container = document.createElement('div');
    container.appendChild(selectedText);
    document.body.appendChild(container);
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const addRange = jest
      .spyOn(selection!, 'addRange')
      .mockImplementation(() => {
        throw new Error('range detached');
      });

    await expect(copyTextToClipboard('copy text')).resolves.toBe(true);

    expect(addRange).toHaveBeenCalled();
  });

  it('reports failure when both copy methods are unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = jest.fn().mockReturnValue(false);

    await expect(copyTextToClipboard('nope')).resolves.toBe(false);

    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
