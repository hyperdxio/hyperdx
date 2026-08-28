'use strict';
/**
 * Pure helpers shared by the review workflow and its dry-run harness.
 *
 * Lives outside the workflow YAML on purpose: inline `github-script` bodies cannot be
 * exercised without triggering a real PR event, and this is the logic most likely to be
 * subtly wrong (diff-hunk arithmetic, dedup keys, fallback routing).
 *
 * In its own directory so the review gate can hash exactly this workflow's dependencies:
 * hashing all of .github/scripts would make an edit to pr-triage or release-notes re-pay
 * for a review of every open PR.
 *
 * `.cjs` rather than `.js`: this is CommonJS loaded by `require` from github-script, and
 * the extension says so without depending on the absence of `"type": "module"`.
 */
const crypto = require('crypto');

const ICON = { critical: '🔴', major: '🟠', minor: '🔵' };

/** Normalize a severity we may have received from a model to one of the three we render. */
function severityOf(finding) {
  return ICON[finding.severity] ? finding.severity : 'minor';
}

/**
 * Map of file -> Set of post-image line numbers that can carry an inline comment.
 *
 * GitHub only accepts a review comment on a line present in the diff, so we derive the
 * legal anchors from the hunk headers rather than trusting the model's line numbers. A
 * context (' ') or added ('+') line consumes a post-image line number; a removed ('-')
 * line does not.
 */
function parseCommentableLines(diffText) {
  const byFile = new Map();
  let file = null;
  let newLine = 0;
  // Remaining post-image lines declared by the current hunk header. While this is > 0 we
  // are inside a hunk body, where a line beginning `+++ b/` or `@@` is *content*, not
  // structure -- an added line whose text is `++ b/x` renders as `+++ b/x`.
  let remaining = 0;

  for (const raw of diffText.split('\n')) {
    if (remaining <= 0) {
      const fileMatch = /^\+\+\+ (.*)$/.exec(raw);
      if (fileMatch) {
        // `+++ /dev/null` marks a deletion: clear the target so a following hunk cannot
        // attribute lines to the previously seen file.
        const target = fileMatch[1].replace(/\t.*$/, '');
        file = target.startsWith('b/') ? target.slice(2) : null;
        if (file) byFile.set(file, new Set());
        continue;
      }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (hunk) {
        newLine = Number(hunk[1]);
        remaining = hunk[2] === undefined ? 1 : Number(hunk[2]);
        continue;
      }
      continue;
    }

    if (raw.startsWith('+') || raw.startsWith(' ')) {
      if (file) byFile.get(file).add(newLine);
      newLine++;
      remaining--;
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" annotates the previous line; consumes nothing.
    }
    // A '-' line consumes no post-image line number and no post-image budget.
  }
  return byFile;
}

/**
 * Stable per-finding id used to avoid reposting across pushes.
 *
 * Keyed on path + normalized title only: bodies get reworded between runs, and keying on
 * them would repost the same finding every push. Titles are stable enough in practice and
 * a false dedup is much cheaper than a duplicate comment.
 */
function fingerprint(finding) {
  const title = String(finding.title || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return crypto
    .createHash('sha256')
    .update(`${finding.file}|${title}`)
    .digest('hex')
    .slice(0, 16);
}

const FINGERPRINT_RE = /<!-- hdxr:([0-9a-f]{16}) -->/;

/** Recover fingerprints we have already posted, from existing bot review comments. */
function seenFingerprints(existingComments) {
  const seen = new Set();
  for (const c of existingComments || []) {
    const m = FINGERPRINT_RE.exec(c.body || '');
    if (m) seen.add(m[1]);
  }
  return seen;
}

function commentBody(finding) {
  const sev = severityOf(finding);
  return `${ICON[sev]} **${sev}** — ${finding.title}\n\n${finding.body}\n\n<!-- hdxr:${fingerprint(finding)} -->`;
}

/**
 * Split findings into inline-anchorable comments and everything else.
 *
 * `unanchored` is not a failure bucket — findings that reference a file the diff never
 * touched are a large slice of the useful output (~9% of all findings, measured), they
 * just have nowhere to hang. They go in the summary instead of being dropped.
 *
 * Each `inline` entry is `{ comment, finding }`: the caller posts `comment`, and if the
 * API rejects the anchor it can move the original `finding` into the summary rather than
 * losing its title, body and severity.
 */
function buildInlineComments({ findings, diffText, existingComments }) {
  const commentable = parseCommentableLines(diffText);
  const seen = seenFingerprints(existingComments);
  const inline = [];
  const unanchored = [];
  const skipped = [];
  const duplicates = [];
  // Only fingerprints recovered from existing comments mean "already posted". A repeat
  // within this run is a same-run duplicate and must not be reported as unchanged.
  const previouslyPosted = new Set(seen);

  for (const finding of findings || []) {
    const fp = fingerprint(finding);
    if (seen.has(fp)) {
      // Count each fingerprint at most once as "already posted"; a repeat within this run
      // is a same-run duplicate even when an earlier push also carried it, or the
      // "N unchanged from an earlier push" tally inflates.
      const bucket = previouslyPosted.delete(fp) ? skipped : duplicates;
      bucket.push({ ...finding, severity: severityOf(finding) });
      continue;
    }
    seen.add(fp);
    const lines = commentable.get(finding.file);
    const line = Number(finding.line);
    if (line && lines && lines.has(line)) {
      inline.push({
        comment: {
          path: finding.file,
          line,
          side: 'RIGHT',
          body: commentBody(finding),
        },
        finding: { ...finding, severity: severityOf(finding) },
      });
    } else {
      unanchored.push({ ...finding, severity: severityOf(finding) });
    }
  }
  return { inline, unanchored, skipped, duplicates };
}

function renderFinding(f) {
  const sev = severityOf(f);
  const loc = `${f.file}${f.line ? `:${f.line}` : ''}`;
  return `- ${ICON[sev]} \`${loc}\` — **${f.title}**${f.body ? ` → ${f.body}` : ''}`;
}

/**
 * The sticky comment body, including the hidden state marker the gate reads next run.
 *
 * On an unhealthy run the marker is deliberately unparseable so the gate fail-opens and
 * the next push re-reviews, rather than caching a zero-coverage review forever.
 */
function renderSummary({
  findings,
  unanchored,
  skipped,
  duplicates,
  posted,
  healthy,
  reason,
  diffHash,
  promptHash,
}) {
  const marker = healthy
    ? `<!-- claude-review-state: diff=${diffHash}; prompt=${promptHash} -->`
    : `<!-- claude-review-state: omitted (review unhealthy) -->`;
  const lines = ['<!-- claude-code-review -->', marker, '## PR Review', ''];

  if (!healthy) {
    lines.push(
      `⚠️ The review did not complete: ${reason || 'unknown error'}.`,
      '',
      'The next push will retry automatically.',
    );
    return lines.join('\n');
  }
  if (!findings || findings.length === 0) {
    lines.push('✅ No issues found.');
    return lines.join('\n');
  }

  // The set actually represented in this comment: first occurrence of each fingerprint.
  // Both the headline total and the per-severity tally run over it, so they agree -- a
  // tally over every finding would not sum to the distinct total once duplicates collapse.
  const seenKeys = new Set();
  const shown = findings.filter(f => {
    const key = fingerprint(f);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  const by = s => shown.filter(f => severityOf(f) === s).length;
  const nUnanchored = unanchored ? unanchored.length : 0;
  const nSkipped = skipped ? skipped.length : 0;
  // Duplicates were collapsed into a single comment, so counting them in the headline
  // would advertise findings that appear nowhere. Report distinct findings.
  const nDuplicates = duplicates ? duplicates.length : 0;
  const distinct = shown.length;
  // Be accurate about where the findings went. "none could be anchored" is wrong when the
  // real reason is that every finding was already posted on an earlier push.
  const delivery =
    posted > 0
      ? `${posted} posted as inline comment(s) on the changed lines.` +
        (nUnanchored ? ` ${nUnanchored} listed below.` : '')
      : nUnanchored
        ? 'None could be anchored to changed lines; they are listed below.'
        : 'Already reported on an earlier push — no new comments.';
  lines.push(
    `**${distinct}** finding(s): 🔴 ${by('critical')} critical · 🟠 ${by('major')} major · 🔵 ${by('minor')} minor` +
      (nDuplicates ? ` · ${nDuplicates} duplicate(s) collapsed` : ''),
    '',
    // Skipped findings are counted above but appear nowhere in this comment -- they are
    // already on the PR as inline comments from an earlier push. Say so, or the totals
    // look like they lost something.
    nSkipped
      ? `${delivery} ${nSkipped} unchanged from an earlier push (already inline above).`
      : delivery,
    '',
  );

  if (unanchored && unanchored.length) {
    const major = unanchored.filter(f => severityOf(f) !== 'minor');
    const minor = unanchored.filter(f => severityOf(f) === 'minor');
    lines.push('### Findings outside the changed lines', '');
    if (major.length) lines.push(...major.map(renderFinding), '');
    // Folded, not dropped: on the eval set minor findings carry 29-57% of everything a
    // human independently flagged, so filtering them would cost about half the recall.
    if (minor.length) {
      lines.push(
        `<details><summary>${minor.length} minor</summary>`,
        '',
        ...minor.map(renderFinding),
        '',
        '</details>',
        '',
      );
    }
  }

  lines.push(
    '---',
    "<sub>Severity is the reviewer's own estimate and is used for ordering, not filtering.</sub>",
  );
  return capBody(lines.join('\n'), marker);
}

/** GitHub rejects an issue-comment body over this, with a 422 on the whole post. */
const MAX_BODY = 65536;

/**
 * Keep the body postable.
 *
 * The state marker lives inside this body, so an over-long body is not merely truncated
 * output: the post fails, no marker is written, and the gate re-reviews and re-pays on
 * every push without ever converging. Truncating is strictly better than that, and the
 * marker is re-emitted so the gate still sees it.
 */
function capBody(body, marker) {
  if (body.length <= MAX_BODY) return body;
  const notice = `\n\n---\n\n_Review truncated to fit GitHub's comment limit; the findings above are complete up to this point._\n${marker}\n`;
  return `${body.slice(0, MAX_BODY - notice.length)}${notice}`;
}

module.exports = {
  ICON,
  severityOf,
  parseCommentableLines,
  fingerprint,
  seenFingerprints,
  commentBody,
  buildInlineComments,
  renderFinding,
  renderSummary,
};

/**
 * Findings that contain a secret, so they can be refused rather than published.
 *
 * The reviewer's `Read` tool is NOT confined to the workspace -- verified: it reads
 * /etc/hosts from an unrelated cwd without a permission prompt. Its findings are then
 * published verbatim to a public PR, so the review body is itself an egress channel and
 * withholding curl/gh-api/WebFetch does not close it. A prompt-injected reviewer could
 * read /proc/self/environ and emit the token inside a finding.
 *
 * This is defence in depth, not a solution: a literal scan cannot catch a secret the
 * reviewer chose to base64 or reverse. The primary mitigations are refusing to treat any
 * repo-authored file as instructions, and not handing long-lived credentials to a job
 * that reviews untrusted code at all.
 */
function findingsLeakingSecrets(findings, secrets) {
  const needles = (secrets || [])
    .map(v => String(v || '').trim())
    // Short values would match constantly; only scan things long enough to be a credential.
    .filter(v => v.length >= 16);
  if (needles.length === 0) return [];
  return (findings || []).filter(f => {
    const fields = [f.title || '', f.body || '', f.file || ''];
    // Check the fields joined BOTH with and without a separator: a credential split
    // across title and body evades a `\n`-joined scan while still rendering adjacent and
    // reconstructable in the published comment.
    const haystacks = [fields.join('\n'), fields.join('')];
    return needles.some(n => haystacks.some(h => h.includes(n)));
  });
}

module.exports.findingsLeakingSecrets = findingsLeakingSecrets;
