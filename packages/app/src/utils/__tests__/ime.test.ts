import { isImeCompositionKey } from '@/utils/ime';

const keyEvent = ({
  isComposing = false,
  keyCode = 13,
}: {
  isComposing?: boolean;
  keyCode?: number;
}) => ({ nativeEvent: { isComposing }, keyCode });

describe('isImeCompositionKey', () => {
  it('detects a keystroke while the IME reports composition', () => {
    expect(isImeCompositionKey(keyEvent({ isComposing: true }))).toBe(true);
  });

  // Safari fires compositionend before the confirming Enter, so isComposing has
  // already cleared and keyCode 229 is the only remaining signal.
  it('detects the confirming Enter that arrives after compositionend', () => {
    expect(isImeCompositionKey(keyEvent({ keyCode: 229 }))).toBe(true);
  });

  it('allows an ordinary Enter press through', () => {
    expect(isImeCompositionKey(keyEvent({ keyCode: 13 }))).toBe(false);
  });

  it('allows ordinary character keys through', () => {
    expect(isImeCompositionKey(keyEvent({ keyCode: 65 }))).toBe(false);
  });
});
