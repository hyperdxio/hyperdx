'use strict';
/**
 * Cross-push dedup: recognising a finding we already posted, even when the reviewer has
 * reworded it. Split from review-comments.cjs because it is the one piece of delivery that
 * makes a judgement about content, and its threshold is calibrated against real data.
 */
const crypto = require('crypto');

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

/**
 * ...and they must share at least this many content words. Jaccard alone over-trusts short
 * titles: "Missing timeout in fetchUser" and "Missing retry in fetchUser" score 0.5 from
 * two shared words, yet need different fixes. Every real restatement in the voted data
 * shares 3 or more (the loosest #3039 pair shares exactly 3), so 3 rejects the short-title
 * collision without losing a measured match.
 */
const MIN_SHARED_TOKENS = 3;

/** Same finding on the same file: enough overlap, from enough words. */
function similarTitles(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared >= MIN_SHARED_TOKENS && titleSimilarity(a, b) >= SIMILAR_TITLE;
}

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
    if (p.file && p.file === finding.file && similarTitles(p.tokens, tokens)) {
      return p;
    }
  }
  return null;
}

/**
 * First occurrence of each finding within one run, matched exactly as delivery matches.
 * The summary's headline and per-priority tallies must count what was delivered; counting
 * by exact fingerprint would show two reworded restatements as two findings when only
 * one was posted.
 */
function distinctFindings(findings) {
  const seen = [];
  const out = [];
  for (const f of findings || []) {
    if (matchPosted(seen, f)) continue;
    seen.push({ fp: fingerprint(f), file: f.file, tokens: titleTokens(f.title) });
    out.push(f);
  }
  return out;
}

module.exports = {
  fingerprint,
  FINGERPRINT_RE,
  seenFingerprints,
  titleTokens,
  titleSimilarity,
  SIMILAR_TITLE,
  MIN_SHARED_TOKENS,
  similarTitles,
  distinctFindings,
  firstLineOf,
  titleFromBody,
  seenFindings,
  matchPosted,
};
