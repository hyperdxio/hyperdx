export function reconstructTemplate(
  originalLog: string,
  templateMined: string,
): string {
  const normalized = originalLog.replace(/\s+/g, ' ');
  const tokens = templateMined.split(' ').filter(t => t.length > 0);
  if (tokens.length === 0) return normalized;

  const tokenOrSeparator = /([A-Za-z0-9]+)|([^A-Za-z0-9]+)/g;
  let result = '';
  let tokenIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenOrSeparator.exec(normalized)) !== null) {
    if (match[1] !== undefined) {
      result += tokens[tokenIdx] ?? match[1];
      tokenIdx++;
    } else {
      result += match[2];
    }
  }
  return result;
}
