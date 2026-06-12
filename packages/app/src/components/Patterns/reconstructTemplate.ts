export function reconstructTemplate(
  originalLog: string,
  templateMined: string,
): string {
  const normalized = originalLog.replace(/\s+/g, ' ');
  const tokens = templateMined.split(' ').filter(t => t.length > 0);
  if (tokens.length === 0) return normalized;

  let result = '';
  let tokenIdx = 0;
  TOKEN_OR_SEPARATOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_OR_SEPARATOR.exec(normalized)) !== null) {
    if (match[1] !== undefined) {
      result += tokens[tokenIdx] ?? match[1];
      tokenIdx++;
    } else {
      result += match[2];
    }
  }
  return result;
}
