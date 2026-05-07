import { notifications } from '@mantine/notifications';

/**
 * Copy text to the clipboard, with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined when the page is served over HTTPS
 * or `localhost`. When HyperDX is reached over plain HTTP (Tailscale tunnel,
 * corporate VPN, non-localhost host), the modern API is undefined and any
 * call to `navigator.clipboard.writeText` throws. This util tries the modern
 * API first and falls back to a hidden-textarea + `document.execCommand('copy')`
 * trick that works in non-secure contexts.
 *
 * Returns `true` on success, `false` if both paths fail.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or other failure. Fall through to the legacy fallback.
    }
  }
  return execCommandFallback(text);
}

function execCommandFallback(text: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  // Preserve any existing selection so we can restore it after the copy.
  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  }

  document.body.removeChild(textarea);

  if (previousRange && selection) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }

  return succeeded;
}

const FAILURE_MESSAGE =
  "Couldn't copy. HyperDX needs HTTPS or localhost to use the browser clipboard API.";

/**
 * Copy text and show a Mantine toast on success or failure. Mirrors the
 * `notifications.show` pattern already used elsewhere in the app for copy
 * actions.
 */
export async function copyTextWithToast(
  text: string,
  successMessage = 'Copied to clipboard',
): Promise<boolean> {
  const ok = await copyTextToClipboard(text);
  if (ok) {
    notifications.show({
      color: 'green',
      message: successMessage,
    });
  } else {
    notifications.show({
      color: 'red',
      message: FAILURE_MESSAGE,
    });
  }
  return ok;
}
