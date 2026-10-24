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
const {
  PRIORITY_ICON,
  PRIORITIES,
  severityOf,
  isSecurityShaped,
  effectivePriority,
  applyGrades,
  regradeInput,
} = require('./priority.cjs');
const {
  fingerprint,
  seenFingerprints,
  titleTokens,
  titleSimilarity,
  SIMILAR_TITLE,
  titleFromBody,
  seenFindings,
  matchPosted,
  distinctFindings,
  MIN_SHARED_TOKENS,
} = require('./dedup.cjs');

const ICON = { critical: '🔴', major: '🟠', minor: '🔵' };

/** GitHub rejects a comment body over this with a 422 on the whole post. */
const MAX_BODY = 65536;

/**
 * Where the triage rule lives; the footers and notice below link here. deep-review.yml's
 * FOOTER repeats the rule and this anchor; the anchor test pins both to the AGENTS.md heading.
 */
const GUIDE_URL =
  'https://github.com/hyperdxio/hyperdx/blob/main/AGENTS.md#responding-to-review-feedback';
const GUIDE_LINK = `[How to respond](${GUIDE_URL})`;

/**
 * Appended to every inline comment. The reader is usually the author's coding agent, and
 * an agent handed forty findings with no instruction fixes forty things -- pre-existing
 * code and "hoist this so X can share it" suggestions included -- dragging unrelated files
 * into the PR (#3091: 3 files became 14, then the PR was closed as superseded).
 *
 * Nothing here blocks merge mechanically (only an unhealthy review fails the check), so
 * the footer says what a maintainer will expect instead, and that depends on priority:
 * a P0/P1 defect in the PR's own code gets fixed; a P2 is the author's call; nothing
 * about surrounding code gets fixed in this PR at any priority. This is the same rule
 * AGENTS.md already states in P0-P3 terms.
 */
const INLINE_FOOTER_BY_PRIORITY = {
  P0:
    '<sub>Nothing blocks merge automatically, but a maintainer will expect this fixed if ' +
    'it is a real defect in code this PR changes. If it is about surrounding code, reply ' +
    `and say so instead of patching. Do not widen the PR. ${GUIDE_LINK}</sub>`,
  P2:
    '<sub>Advisory. Fix if it is a small defect in code this PR changes; otherwise reply ' +
    'in the thread. Do not widen the PR or touch files it did not already change. ' +
    `${GUIDE_LINK}</sub>`,
};
INLINE_FOOTER_BY_PRIORITY.P1 = INLINE_FOOTER_BY_PRIORITY.P0;
// P3 is never posted inline; the entry exists so a caller can never get `undefined`.
INLINE_FOOTER_BY_PRIORITY.P3 = INLINE_FOOTER_BY_PRIORITY.P2;

function inlineFooter(finding) {
  return INLINE_FOOTER_BY_PRIORITY[effectivePriority(finding)];
}

/** Leads the summary: the footers' rule as a blockquoted list, plus what one comment cannot say. */
const AGENT_NOTICE = [
  '> **If you are a coding agent acting for the author, read this first.**',
  '> Nothing below blocks merge automatically; a maintainer decides. What they will expect:',
  '> - 🔴 P0/P1 in code this PR adds or changes: fix before asking for review.',
  '> - 🟡 P2 in code this PR changes: your call. Fix if small, otherwise reply.',
  '> - 🔵 P3 is collapsed at the bottom: nobody needs to act on it before merge.',
  '> - Anything about surrounding code, or asking you to widen the change (hoist a helper,',
  '>   dedupe with another file, fix other call sites): never fix here, whatever the',
  '>   priority. Reply with one sentence; if it is P0, say so plainly so a human sees it.',
  '>',
  '> One commit per review round. After two rounds, stop and ask a maintainer to review',
  `> scope rather than addressing more automated findings. Full rule: [AGENTS.md](${GUIDE_URL}).`,
].join('\n');

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

/** Hidden per-comment marker: the dedup key, plus the inputs that decided the priority. */
function marker(finding) {
  const attrs = [];
  if (PRIORITIES.includes(finding.priority)) attrs.push(`p=${finding.priority}`);
  attrs.push(`sev=${severityOf(finding)}`);
  if (typeof finding.reachableToday === 'boolean') attrs.push(`reach=${finding.reachableToday}`);
  return `<!-- hdxr:${fingerprint(finding)} ${attrs.join(' ')} -->`;
}

function commentBody(finding) {
  const p = effectivePriority(finding);
  const mark = marker(finding);
  const head = `${PRIORITY_ICON[p]} **${p}** — ${finding.title}\n\n`;
  // Cap like the summary. GitHub rejects an over-long comment with a 422 on the whole
  // batch, and the individual retry then fails the same way, so one oversized finding
  // would take out every other inline comment in the run.
  const footer = inlineFooter(finding);
  const room = MAX_BODY - head.length - footer.length - mark.length - 32;
  const body =
    finding.body.length > room
      ? `${finding.body.slice(0, room)}\n\n_(truncated)_`
      : finding.body;
  return `${head}${body}\n\n${footer}\n\n${mark}`;
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
 *
 * `collapsed` is every new P3, anchored or not. They are folded into the summary instead
 * of opening a thread: P3 means nobody needs to act on it before merge, and an inline
 * thread is an action item in the author's queue. Folded, never dropped.
 */
function buildInlineComments({ findings, diffText, existingComments }) {
  const commentable = parseCommentableLines(diffText);
  // Only entries recovered from existing comments mean "already posted" (fromPush). A
  // repeat within this run is a same-run duplicate and must not be reported as unchanged,
  // so each posted entry counts as "unchanged" at most once, or that tally inflates.
  const posted = seenFindings(existingComments);
  const inline = [];
  const unanchored = [];
  const collapsed = [];
  const skipped = [];
  const duplicates = [];

  for (const finding of findings || []) {
    const match = matchPosted(posted, finding);
    if (match) {
      const bucket = match.fromPush && !match.counted ? skipped : duplicates;
      match.counted = true;
      bucket.push({ ...finding, severity: severityOf(finding) });
      continue;
    }
    posted.push({
      fp: fingerprint(finding),
      file: finding.file,
      tokens: titleTokens(finding.title),
      fromPush: false,
      counted: true,
    });
    if (effectivePriority(finding) === 'P3') {
      collapsed.push({ ...finding, severity: severityOf(finding) });
      continue;
    }
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
  return { inline, unanchored, collapsed, skipped, duplicates };
}

function renderFinding(f) {
  const p = effectivePriority(f);
  const loc = `${f.file}${f.line ? `:${f.line}` : ''}`;
  return `- ${PRIORITY_ICON[p]} **${p}** \`${loc}\` — **${f.title}**${f.body ? ` → ${f.body}` : ''}`;
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
  collapsed,
  graded = true,
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

  lines.push(AGENT_NOTICE, '');

  // The set actually represented in this comment: first occurrence of each finding,
  // matched the same way delivery matches (fingerprint OR reworded title). Both the
  // headline total and the per-priority tally run over it, so they agree -- and a pair of
  // restatements that delivery collapsed into one comment is counted once here too.
  const shown = distinctFindings(findings);
  const by = (...ps) => shown.filter(f => ps.includes(effectivePriority(f))).length;
  const nUnanchored = unanchored ? unanchored.length : 0;
  const nCollapsed = collapsed ? collapsed.length : 0;
  const nSkipped = skipped ? skipped.length : 0;
  // Duplicates were collapsed into a single comment, so counting them in the headline
  // would advertise findings that appear nowhere. Report distinct findings.
  const nDuplicates = duplicates ? duplicates.length : 0;
  const distinct = shown.length;
  // Be accurate about where the findings went. "none could be anchored" is wrong when the
  // real reason is that every finding was already posted on an earlier push.
  const delivery =
    (posted > 0
      ? `${posted} posted as inline comment(s) on the changed lines.` +
        (nUnanchored ? ` ${nUnanchored} listed below.` : '')
      : nUnanchored
        ? 'None could be anchored to changed lines; they are listed below.'
        : nCollapsed
          ? 'No inline comments.'
          : 'Already reported on an earlier push — no new comments.') +
    (nCollapsed ? ` ${nCollapsed} P3 folded at the bottom.` : '');
  lines.push(
    `**${distinct}** finding(s): 🔴 ${by('P0', 'P1')} P0/P1 · 🟡 ${by('P2')} P2 · 🔵 ${by('P3')} P3` +
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

  if (!graded) {
    lines.push(
      '⚠️ Priority grading did not run this time, so nothing was folded: every finding is ' +
        "posted, ranked by the reviewer's own estimate.",
      '',
    );
  }

  if (unanchored && unanchored.length) {
    lines.push('### Findings outside the changed lines', '');
    lines.push(...unanchored.map(renderFinding), '');
  }

  // Folded, never dropped: hiding a finding entirely would cost recall the eval measured,
  // and a P3 is still true -- it just does not need anyone before merge.
  if (nCollapsed) {
    lines.push(
      `<details><summary>🔵 ${nCollapsed} P3 — no action needed before merge</summary>`,
      '',
      ...collapsed.map(renderFinding),
      '',
      '</details>',
      '',
    );
  }

  lines.push(
    '---',
    '<sub>Priority comes from a separate grading pass over the finished review. P3 is folded ' +
      'here instead of posted inline. No finding blocks merge automatically; a maintainer ' +
      'decides.</sub>',
  );
  return capBody(lines.join('\n'), marker);
}

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
  GUIDE_URL,
  inlineFooter,
  AGENT_NOTICE,
  severityOf,
  parseCommentableLines,
  fingerprint,
  seenFingerprints,
  seenFindings,
  titleTokens,
  titleSimilarity,
  titleFromBody,
  SIMILAR_TITLE,
  MIN_SHARED_TOKENS,
  distinctFindings,
  PRIORITY_ICON,
  effectivePriority,
  applyGrades,
  regradeInput,
  isSecurityShaped,
  commentBody,
  buildInlineComments,
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
    // Scan the strings that are actually PUBLISHED, in the order they are published.
    // Guessing a field order misses a credential straddling two fields: the inline body
    // renders title then body, while the summary line renders file then title.
    //
    // Also compare with everything outside credential-shaped characters removed, so the
    // markup between two halves (the summary renders `file` — **title**) cannot hide a
    // split secret a reader can still reconstruct. Needles are >= 16 characters, so
    // collapsing punctuation does not realistically create a false match.
    const collapse = t => t.replace(/[^A-Za-z0-9_-]/g, '');
    const published = [commentBody(f), renderFinding(f)];
    const haystacks = [...published, ...published.map(collapse)];
    return needles.some(n =>
      haystacks.some(h => h.includes(n) || h.includes(collapse(n))),
    );
  });
}

module.exports.findingsLeakingSecrets = findingsLeakingSecrets;
