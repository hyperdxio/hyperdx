// Syntax gate for .github/VOUCHED.td.
//
// The list is the trust boundary for outside contributions, and vouch PRs are
// auto-merged once a maintainer approves them (.github/workflows/vouch-check.yml),
// so a malformed edit that silently drops or mis-parses a handle has to be
// caught here rather than at the next PR. Provenance — did a maintainer really
// ask for this? — is checked in the workflow, not here.
//
// Rules are the ones documented in the header of VOUCHED.td itself.

// GitHub handles: alphanumerics and single inner hyphens, 39 chars max. Already
// lower-cased, because vouch lower-cases when it rewrites the file and a
// mixed-case entry means someone hand-edited it.
const HANDLE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;

// -handle => denounced, github: => optional platform prefix, trailing text is
// free-form detail (the reason from `/vouch @user reason`), not part of the key.
const ENTRY = /^(-?)(?:github:)?(\S+)(?:\s+.*)?$/;

/**
 * @returns {{entries: {handle: string, denounced: boolean, line: number}[],
 *            errors: string[]}}
 */
export function parseList(text) {
  const entries = [];
  const errors = [];

  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line === '' || line.trimStart().startsWith('#')) return;
    const lineNo = i + 1;

    if (line !== raw.trim()) {
      errors.push(`line ${lineNo}: leading whitespace`);
      return;
    }
    const match = ENTRY.exec(line);
    if (!match) {
      errors.push(`line ${lineNo}: cannot parse "${line}"`);
      return;
    }
    const [, minus, handle] = match;
    if (!HANDLE.test(handle)) {
      errors.push(
        `line ${lineNo}: "${handle}" is not a lower-case GitHub handle`,
      );
      return;
    }
    entries.push({ handle, denounced: minus === '-', line: lineNo });
  });

  const seen = new Map();
  for (const { handle, line } of entries) {
    if (seen.has(handle)) {
      errors.push(
        `line ${line}: "${handle}" already listed on line ${seen.get(handle)}`,
      );
    } else {
      seen.set(handle, line);
    }
  }

  for (let i = 1; i < entries.length; i++) {
    if (entries[i].handle < entries[i - 1].handle) {
      errors.push(
        `line ${entries[i].line}: "${entries[i].handle}" is out of order after "${entries[i - 1].handle}"`,
      );
    }
  }

  return { entries, errors };
}

/**
 * What a change to the list did. `added` drives the "is this a real account?"
 * lookup in the workflow; `changed` covers a vouch flipping to a denounce,
 * which adds no handle but is still a trust decision.
 *
 * @returns {{added: string[], removed: string[], changed: string[], errors: string[]}}
 */
export function diffLists(baseText, headText) {
  const base = parseList(baseText);
  const head = parseList(headText);

  // A base that is already broken is not this PR's fault, and reporting it
  // would block every subsequent vouch until someone fixes main by hand.
  const errors = head.errors;

  const byHandle = list => new Map(list.map(e => [e.handle, e]));
  const before = byHandle(base.entries);
  const after = byHandle(head.entries);

  const added = [...after.keys()].filter(h => !before.has(h));
  const removed = [...before.keys()].filter(h => !after.has(h));
  const changed = [...after.keys()].filter(
    h => before.has(h) && before.get(h).denounced !== after.get(h).denounced,
  );

  return { added, removed, changed, errors };
}
