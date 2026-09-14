/**
 * The subset of a React keyboard event needed to detect IME composition.
 * `isComposing` is read off the native event because React's synthetic
 * keyboard event does not carry it.
 */
type CompositionKeyEvent = {
  nativeEvent: { isComposing: boolean };
  keyCode: number;
};

/**
 * `keyCode` browsers report while an IME owns the keystroke ("Process").
 */
const IME_PROCESS_KEY_CODE = 229;

/**
 * True when a keystroke belongs to an in-flight IME conversion rather than
 * being a deliberate keypress. Callers gate Enter-to-submit on this so that
 * confirming a Japanese/Korean/Chinese conversion does not also submit.
 *
 * `isComposing` alone is not enough. Safari dispatches the Enter that confirms
 * a conversion *after* `compositionend`, by which point the flag has already
 * cleared; that keystroke still carries keyCode 229, so both signals are
 * checked. A real Enter reports keyCode 13 with `isComposing` false, so this
 * never swallows a keypress the user meant.
 */
export function isImeCompositionKey(event: CompositionKeyEvent): boolean {
  return (
    event.nativeEvent.isComposing || event.keyCode === IME_PROCESS_KEY_CODE
  );
}
