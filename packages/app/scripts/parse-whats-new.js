// Parses the most recent release blocks out of `@hyperdx/app`'s CHANGELOG.md
// into a bounded list of releases (each with its feature headlines) for the
// Help menu's "What's new" section and drawer.
//
// CommonJS on purpose: this is imported both by next.config.mjs at build time
// (ESM default-import interop) and by the Jest unit test under src/ — one source
// of truth, no build-step gymnastics.

// Matches a changeset bullet's leading commit hash, e.g. "ff05b3df: ".
const HASH_PREFIX = /^[0-9a-f]{7,40}:\s*/i;
// Matches a `feat` conventional-commit prefix, capturing the optional scope:
// feat: / feat(scope): / feat(scope)!: — group 1 is the scope, if any.
const FEAT_PREFIX = /^feat(?:\(([^)]*)\))?!?:\s*/i;
// Features with no `feat(scope)` get bucketed under this.
const DEFAULT_SCOPE = 'general';

// Abbreviations whose trailing period is not a sentence end. Without these,
// "Supports Postgres, etc. Adds a picker" would cut to "Supports Postgres, etc"
// — throwing away the part of the headline that describes the feature.
const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.'];

// Returns the first sentence of `text`. A period ends a sentence only when it is
// followed by whitespace/end and is not one of ABBREVIATIONS.
//
// Note there is deliberately no special case for decimals/version numbers: the
// period in "1.5x" is followed by a digit, so `/\.(\s|$)/` never matches it in
// the first place. An explicit digit guard here would be dead for decimals and
// actively wrong for a sentence that simply ends in a number ("...cap to 10.").
function firstSentence(text) {
  const re = /\.(\s|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    const tail = text.slice(0, idx + 1).toLowerCase();
    if (ABBREVIATIONS.some(abbr => tail.endsWith(abbr))) continue;
    return text.slice(0, idx);
  }
  // No terminator found: whole thing is one sentence; drop a trailing period.
  return text.replace(/\.\s*$/, '');
}

// Changeset messages are markdown, but the headlines render as plain text in the
// Help menu and drawer. Only code spans occur in practice, so only they are
// unwrapped — `Add \`link\` variant` would otherwise show its backticks.
function stripInlineMarkdown(text) {
  return text.replace(/`([^`]+)`/g, '$1');
}

function capitalise(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

// Groups the raw lines of a version block into individual changeset items. A
// top-level `- ` line starts an item; indented continuation lines (soft-wrapped
// prose) are joined onto it. `### ` subsection headings and blank lines just
// separate items.
function toItems(lines) {
  const items = [];
  let current = null;
  for (const line of lines) {
    if (/^- /.test(line)) {
      if (current != null) items.push(current);
      current = line.replace(/^- /, '').trim();
    } else if (
      current != null &&
      /^\s+\S/.test(line) &&
      !/^\s+-\s/.test(line)
    ) {
      // Continuation of the current item (indented, not a nested sub-bullet).
      current += ' ' + line.trim();
    } else if (/^\s*$/.test(line) || /^### /.test(line)) {
      if (current != null) items.push(current);
      current = null;
    }
  }
  if (current != null) items.push(current);
  return items;
}

// Extracts the `feat`-only headlines from a single version block's raw text.
// Each feature carries its `feat(scope)` (or `general`) and the first sentence
// of the message, capitalised.
function featuresFromBlock(block) {
  const features = [];
  for (const item of toItems(block.split('\n'))) {
    const withoutHash = item.replace(HASH_PREFIX, '');
    const match = withoutHash.match(FEAT_PREFIX);
    if (!match) continue;
    const scope = (match[1] || '').trim() || DEFAULT_SCOPE;
    const message = withoutHash.slice(match[0].length);
    const text = capitalise(
      stripInlineMarkdown(firstSentence(message).trim()),
    );
    if (text) features.push({ scope, text });
  }
  return features;
}

/**
 * @param {string} changelogMarkdown Full CHANGELOG.md contents.
 * @param {{ maxReleases?: number }} [opts]
 * @returns {{ releases: { version: string, features: { scope: string, text: string }[] }[] }}
 */
function parseWhatsNew(changelogMarkdown, opts = {}) {
  const maxReleases = opts.maxReleases ?? 5;
  const text = changelogMarkdown ?? '';

  // Split on each `## <version>` heading, capturing the version. `matchAll`
  // gives us each heading's index so we can slice the block up to the next one.
  const headingRe = /^##\s+(.+?)\s*$/gm;
  const headings = [...text.matchAll(headingRe)];

  const releases = [];
  for (let i = 0; i < headings.length && releases.length < maxReleases; i++) {
    const version = headings[i][1].trim();
    const blockStart = headings[i].index + headings[i][0].length;
    const blockEnd =
      i + 1 < headings.length ? headings[i + 1].index : text.length;
    const block = text.slice(blockStart, blockEnd);
    releases.push({ version, features: featuresFromBlock(block) });
  }

  return { releases };
}

module.exports = parseWhatsNew;
