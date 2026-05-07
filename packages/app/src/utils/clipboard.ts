import { notifications } from '@mantine/notifications';

/**
 * Refuse to fall back to `document.execCommand('copy')` for payloads larger
 * than this. The fallback path is fully synchronous (textarea + select +
 * execCommand) and freezes the main thread for multi-MB JSON copies.
 */
const FALLBACK_MAX_BYTES = 1_000_000;

/**
 * Copy text to the clipboard, with a fallback for non-secure contexts.
 *
 * `navigator.clipboard` is only defined when the page is served over HTTPS
 * or `localhost`. When HyperDX is reached over plain HTTP (Tailscale tunnel,
 * corporate VPN, non-localhost host), the modern API is undefined and any
 * call to `navigator.clipboard.writeText` throws.
 *
 * In non-secure contexts we route straight to the synchronous textarea +
 * `document.execCommand('copy')` fallback. Doing the modern attempt first
 * would burn the click's user-activation token on an awaited rejection, so
 * the fallback that runs afterwards has lost activation and silently fails.
 *
 * Returns `true` on success, `false` if both paths fail or the payload is
 * larger than the fallback limit and the modern path isn't available.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (isSecureContextWithClipboard()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Permission denied / sandboxed iframe / another race. Log and fall
      // through to the legacy fallback so we still have a chance to copy.

      console.warn(
        'clipboard writeText failed; trying execCommand fallback',
        err,
      );
    }
  }

  if (text.length > FALLBACK_MAX_BYTES) {
    console.warn(
      `clipboard fallback refused: payload ${text.length} > ${FALLBACK_MAX_BYTES} bytes`,
    );
    return false;
  }

  return execCommandFallback(text);
}

function isSecureContextWithClipboard(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  // `isSecureContext` is true on HTTPS and on `http://localhost`. Browsers
  // only expose `navigator.clipboard.writeText` in secure contexts; checking
  // both guards against the rare browser that exposes the API but blocks
  // the call.
  return (
    window.isSecureContext === true && Boolean(navigator.clipboard?.writeText)
  );
}

function execCommandFallback(text: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  // Capture focus and selection state before we mount the scratch textarea so
  // we can restore both in the finally block. Use `instanceof HTMLElement` so
  // SVG / MathML elements (which subclass `Element` but not `HTMLElement`)
  // don't slip through.
  const active = document.activeElement;
  const previouslyFocused = active instanceof HTMLElement ? active : null;
  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch (err) {
    console.warn('clipboard execCommand fallback failed', err);
    succeeded = false;
  } finally {
    document.body.removeChild(textarea);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
    // Restore focus so typing context is not silently lost on the HTTP
    // fallback path.
    previouslyFocused?.focus();
  }

  return succeeded;
}

/**
 * Failure message shown when the modern API is unavailable AND the fallback
 * path also fails. The wording deliberately leaves room for permission-denied
 * and sandboxed-iframe cases (it doesn't assert "you must switch to HTTPS"),
 * since the secure-context check above means we only reach this message via
 * an actual fallback failure, not via a never-attempted secure context.
 */
const FAILURE_MESSAGE =
  "Couldn't copy to clipboard. If you're on plain HTTP, switch to HTTPS or localhost.";

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
