export const CLIPBOARD_ERROR_MESSAGE =
  'Could not access the clipboard. Check browser permissions or use HTTPS.';

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  return copyTextWithTextarea(text);
}

function copyTextWithTextarea(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.width = '1px';
  textArea.style.height = '1px';
  textArea.style.padding = '0';
  textArea.style.border = 'none';
  textArea.style.outline = 'none';
  textArea.style.boxShadow = 'none';
  textArea.style.background = 'transparent';

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textArea);
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textArea);
    if (previousRange && selection) {
      try {
        selection.removeAllRanges();
        selection.addRange(previousRange);
      } catch {
        // Ignore restore failures if the previous selection was detached.
      }
    }
  }

  return copied;
}
