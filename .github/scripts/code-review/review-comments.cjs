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

/**
 * What users see. Severity above is still produced by the reviewer and still drives the
 * policy below, but it is no longer rendered: one comment carrying two grades on two
 * different scales was the thing to avoid. Icons match deep-review.yml's sections
 * (🔴 P0/P1, 🟡 P2, 🔵 P3) so the two bots read the same on one PR.
 */
const PRIORITY_ICON = { P0: '🔴', P1: '🔴', P2: '🟡', P3: '🔵' };
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

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

/** Normalize a severity we may have received from a model to one of the three the reviewer emits. */
function severityOf(finding) {
  return ICON[finding.severity] ? finding.severity : 'minor';
}

/**
 * Security-shaped wording. A finding like this may be graded down, but never collapsed: a
 * grader once filed an unescaped SQL splice as a nit on the grounds that the attacker would
 * need DDL rights (hdx-code-reviewer, PR #1620). Matching wording rather than a field is
 * deliberate here -- this is a floor, so a false positive only keeps a comment visible.
 */
const SECURITY_SHAPED =
  /\b(sql[- ]?injection|injection|xss|cross[- ]site|rce|remote code execution|deserializ|ssrf|csrf|path traversal|directory traversal|auth(?:n|z)?\s+bypass|authentication bypass|authorization bypass|privilege escalation|unescaped|unsanitized|sanitiz|secret|credential|api[- ]?key|password|token leak)\b/i;

function isSecurityShaped(finding) {
  return SECURITY_SHAPED.test(
    `${finding.title || ''} ${finding.body || ''} ${finding.consequence || ''}`,
  );
}

/**
 * Without a grade, nothing is hidden. The grading pass is a separate model call and can
 * fail on its own; when it does, every finding is still posted, ranked the way the
 * reviewer's own severity always ranked it. Failing toward "post it" is the same direction
 * every other fallback in this workflow takes.
 */
const UNGRADED_PRIORITY = { critical: 'P0', major: 'P1', minor: 'P2' };

/**
 * The one priority this finding is shown and routed with. Order is load-bearing:
 *
 *  1. The grader's priority (or the ungraded fallback above).
 *  2. A grader P3 that names a failure mode is raised to P2. The grading prompt promises
 *     this ("a P3 with hasFailureMode=true is automatically raised"), so it has to hold.
 *  3. POLICY: a P2 that the reviewer itself called `minor` is shown as P3 (collapsed). Two
 *     independent graders both calling it low is the signal; either one alone is not.
 *     Measured on 75 human-voted findings this hides ~35% of comments while keeping every
 *     upvoted major/critical finding inline.
 *  4. FLOORS, last word: anything reachable today, or security-shaped, is never collapsed.
 *
 * Step 2 must come BEFORE step 3. Run after it, the failure-mode clamp re-raises 13 of the
 * 22 minor P2s the policy exists to fold, and the policy stops doing anything.
 */
function effectivePriority(finding) {
  const graded = PRIORITIES.includes(finding.priority);
  let p = graded ? finding.priority : UNGRADED_PRIORITY[severityOf(finding)];
  if (!graded) return p;
  if (p === 'P3' && finding.hasFailureMode === true) p = 'P2';
  if (p === 'P2' && severityOf(finding) === 'minor') p = 'P3';
  if (p === 'P3' && (finding.reachableToday === true || isSecurityShaped(finding))) p = 'P2';
  return p;
}

/**
 * Merge the grading pass's output onto the reviewer's findings by index. A grade for an
 * index that does not exist, or with an unknown priority, is dropped and that finding stays
 * ungraded (posted, per UNGRADED_PRIORITY) rather than guessed at.
 */
function applyGrades(findings, grades) {
  const byIndex = new Map();
  for (const g of grades || []) {
    if (Number.isInteger(g && g.index) && PRIORITIES.includes(g.priority)) byIndex.set(g.index, g);
  }
  return (findings || []).map((f, i) => {
    const g = byIndex.get(i);
    if (!g) return f;
    return {
      ...f,
      priority: g.priority,
      hasFailureMode: g.hasFailureMode === true,
      reachableToday: g.reachableToday === true,
      consequence: typeof g.consequence === 'string' ? g.consequence : undefined,
    };
  });
}

/** The findings as the grading pass reads them. Bodies are capped like the harness capped them. */
function regradeInput(findings) {
  return [
    `FINDINGS TO GRADE (${(findings || []).length}) -- return exactly one grade per index:`,
    '',
    ...(findings || []).map(
      (f, i) =>
        `- index: ${i}\n  file: ${f.file}\n  issue: ${f.title}\n  detail: ${String(f.body || '').slice(0, 1200)}`,
    ),
    '',
  ].join('\n');
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
 * them would repost the same finding every push.
 *
 * TITLES ARE NOT STABLE EITHER, which this used to assume. PR #3039 was reviewed four
 * times in 2.3 hours and the same defect was posted three times, as "New `start`/`end`
 * params on the app's `labelValues` client have no caller", "...on the app client have no
 * caller, and the only consumer's query key can't hold them" and "...on
 * `prometheusApi.labelValues` have no caller": three titles, three fingerprints, three
 * threads, all three thumbed down. So the exact fingerprint is now only the fast path, and
 * `matchPosted` below catches a reworded restatement on the same file.
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

// The marker may carry attributes after the fingerprint (`p=P2 sev=minor reach=true`) so a
// later analysis can tell which input decided a grade. deep-review.yml matches only the
// `<!-- hdxr:` prefix, so it is unaffected.
const FINGERPRINT_RE = /<!-- hdxr:([0-9a-f]{16})(?: [^>]*)? -->/;

/** Recover fingerprints we have already posted, from existing bot review comments. */
function seenFingerprints(existingComments) {
  const seen = new Set();
  for (const c of existingComments || []) {
    const m = FINGERPRINT_RE.exec(c.body || '');
    if (m) seen.add(m[1]);
  }
  return seen;
}

/**
 * Words that survive rewording carry the claim; these do not. Kept short on purpose: every
 * word removed also raises the similarity of two UNRELATED titles, and a false dedup
 * silently drops a real finding.
 */
const TITLE_STOPWORDS = new Set(
  ('a an the is are was were be been its it to of on in into at by for from with and or so but ' +
    'that this these those now new only every not no has have had can cannot never always when ' +
    'which while they them their there here per both as if then than does do silently still')
    .split(' '),
);

/** Content tokens of a title: identifiers survive, prose connectives do not. */
function titleTokens(title) {
  const words =
    String(title || '')
      .toLowerCase()
      .replace(/<[^>]*>/g, ' ')
      .replace(/[`*_]/g, '')
      .match(/[a-z0-9_.[\]/]+/g) || [];
  return new Set(words.filter(w => w.length > 1 && !TITLE_STOPWORDS.has(w)));
}

/** Jaccard overlap of two token sets. */
function titleSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Two titles on the SAME FILE at or above this overlap are one finding.
 *
 * Set from all 140 same-PR, same-file pairs of this bot's human-voted findings. Every pair
 * at or above 0.36 is a restatement. At 0.333 restatements and genuinely distinct findings
 * collide: on #3129, "signs every user out on each container restart" and "still signs
 * sessions with the public secret" are two real defects (the second critical) at exactly
 * that score. Lowering the bar to catch one more reword would suppress a critical finding,
 * so 0.4 takes that miss.
 */
const SIMILAR_TITLE = 0.4;

function firstLineOf(body) {
  return String(body || '').replace(/^\s+/, '').split('\n')[0] || '';
}

/** The title out of a posted comment body, in either the old severity or new priority form. */
function titleFromBody(body) {
  const first = firstLineOf(body);
  const m = /^(?:\S+\s+)?\*\*(?:critical|major|minor|P[0-3])\*\*\s*(?:—|--)?\s*(.*)$/.exec(first);
  return (m ? m[1] : first).trim();
}

/**
 * Findings already posted, in the shape matchPosted compares: the exact fingerprint plus
 * the file and title tokens a reworded restatement would still share.
 */
function seenFindings(existingComments) {
  const posted = [];
  for (const c of existingComments || []) {
    const m = FINGERPRINT_RE.exec(c.body || '');
    if (!m) continue;
    posted.push({
      fp: m[1],
      file: c.path || null,
      tokens: titleTokens(titleFromBody(c.body)),
      fromPush: true,
      counted: false,
    });
  }
  return posted;
}

/** The posted entry this finding restates, or null. */
function matchPosted(posted, finding) {
  const fp = fingerprint(finding);
  const tokens = titleTokens(finding.title);
  for (const p of posted) {
    if (p.fp === fp) return p;
    // File-scoped: the same words about a different file are a different finding.
    if (p.file && p.file === finding.file && titleSimilarity(p.tokens, tokens) >= SIMILAR_TITLE) {
      return p;
    }
  }
  return null;
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
