// Parses the repo-root CHANGELOG.md — the release-level summary written during
// each release — into a bounded list of releases for the Help menu's "What's
// new" section and drawer.
//
// Each release yields the headline and summary the release notes open with (the
// generator writes both — see .github/prompts/release-changelog.md), the
// individual breaking changes and new features taken from the bolded lead-in
// each bullet opens with, and a count for every other section, so a release that
// shipped 12 fixes says so without listing them.
//
// Nothing here is invented or reworded: every string the app shows comes from
// the release notes a human reviewed on the release PR.
//
// Deliberately the root changelog and not `packages/app/CHANGELOG.md`: the
// latter is changeset bodies, one per PR, with no notion of which change
// mattered.
//
// CommonJS on purpose: this is imported both by next.config.mjs at build time
// (ESM default-import interop) and by the Jest unit test under src/ — one source
// of truth, no build-step gymnastics.

// Sections whose bullets are surfaced individually, in this order.
const HIGHLIGHT_SECTIONS = [
  { pattern: /breaking changes/i, kind: 'breaking' },
  { pattern: /new features/i, kind: 'feature' },
];

// The package list the release workflow appends is not a set of changes, so it
// must not land in the counts as though it were.
const IGNORED_SECTION = /package changelogs/i;

// The marker the release workflow writes under each heading. Kept in sync with
// .github/scripts/release-notes.mjs, and pinned there by a test.
const RELEASE_NOTES_MARKER = /<!-- hyperdx-release-notes[^>]*-->\n?/g;

// The headline: a line that is nothing but bold text, which is how the notes
// open a release before its summary paragraph.
const TITLE_LINE = /^\*\*(.+)\*\*$/;

// A bullet's bolded lead-in: `- **Formulas on every chart**: you can now...`.
// Non-greedy so it stops at the closing `**` and not at a later bold span.
const BOLD_LEAD = /^\*\*(.+?)\*\*/;

// Abbreviations whose trailing period is not a sentence end. Without these,
// "Supports Postgres, etc. Adds a picker" would cut to "Supports Postgres, etc"
// — throwing away the part of the headline that describes the change.
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

// The release notes are markdown, but headlines render as plain text in the Help
// menu and drawer. Code spans and bold are what occur in practice, so only those
// are unwrapped — `Add a \`link\` variant` would otherwise show its backticks.
function stripInlineMarkdown(text) {
  return text.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
}

function capitalise(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text;
}

// Capitalises a fragment promoted to a sentence of its own, leaving a leading
// code span alone — `clickstack_emerging_signals` must not become
// `Clickstack_emerging_signals`.
function capitaliseSentence(text) {
  return text.startsWith('`') ? text : capitalise(text);
}

// Section heading -> count label: "🐛 Bug Fixes" becomes "bug fixes". Strips the
// leading emoji rather than matching known headings, so a section the release
// notes add later still counts instead of silently vanishing.
function countLabel(heading) {
  return heading.replace(/^[^\p{L}]+/u, '').toLowerCase();
}

// GitHub's heading-anchor slug: lowercase, drop punctuation, spaces to hyphens.
// Used to deep-link a release's counts at its section of the changelog. An
// anchor GitHub disagrees with just lands the reader at the top of the file, so
// this does not need to be exact to be useful.
function githubAnchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Groups the raw lines of a block into individual bullets. A top-level `- ` line
// starts one; indented continuation lines (soft-wrapped prose, including a bold
// lead-in that wrapped mid-span) are joined onto it. Nested sub-bullets and
// blank lines just separate.
function toItems(lines) {
  const items = [];
  let current = null;
  const flush = () => {
    if (current != null) items.push(current);
    current = null;
  };
  for (const line of lines) {
    if (/^- /.test(line)) {
      if (current != null) items.push(current);
      current = line.replace(/^- /, '').trim();
    } else if (
      current != null &&
      /^\s+\S/.test(line) &&
      !/^\s+-\s/.test(line)
    ) {
      current += ' ' + line.trim();
    } else if (/^\s*$/.test(line)) {
      flush();
    }
  }
  flush();
  return items;
}

// Restores the full stop `firstSentence` strips, so the summary reads as a
// sentence rather than a truncation.
function withFullStop(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// The headline and one-sentence summary a release opens with, from the text above
// its first `### ` section.
//
// Only the first sentence: the notes open with a full paragraph, and a paragraph
// in the app's release card reads as a wall of prose rather than a headline. The
// rest is a click away on GitHub.
//
// A release whose notes carry no bolded headline — everything written before the
// generator was asked for one, and anything a maintainer strips — promotes that
// first sentence to the headline instead, so the card never leads with body text.
function toPreamble(block) {
  const firstSection = block.search(/^### /m);
  const lines = (firstSection === -1 ? block : block.slice(0, firstSection))
    .replace(RELEASE_NOTES_MARKER, '')
    .split('\n')
    .map(line => line.trim());

  let title;
  const paragraph = [];
  for (const line of lines) {
    if (!line) continue;
    const heading = line.match(TITLE_LINE);
    if (heading && title == null && paragraph.length === 0) {
      title = stripInlineMarkdown(heading[1]).trim();
      continue;
    }
    paragraph.push(line);
  }

  const opening = firstSentence(paragraph.join(' ').trim()).trim();
  if (!opening) return { title, summary: undefined };
  if (title) return { title, summary: withFullStop(opening) };

  // No headline in the notes, so split the opening sentence into one: it is
  // written as "the claim: the detail", and the claim reads as a headline with
  // the detail below it. Only releases predating the generated headline take
  // this path, so the rule never needs to be cleverer than the prose it was
  // measured against.
  //
  // ponytail: first colon, no NLP. A sentence without one keeps its whole self
  // as the summary rather than being cut somewhere arbitrary.
  const [claim, ...detail] = opening.split(/:\s+/);
  if (detail.length === 0) return { title: undefined, summary: withFullStop(opening) };
  return {
    // Plain text, like every other headline — no stray markdown on screen.
    title: stripInlineMarkdown(claim),
    summary: withFullStop(capitaliseSentence(detail.join(': '))),
  };
}

// Splits a release block into its `### ` sections, keyed by heading. The text
// above the first heading is the preamble, not a section.
function toSections(block) {
  const sections = [];
  let current = null;
  for (const line of block.split('\n')) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      current = { heading: heading[1], lines: [] };
      sections.push(current);
    } else if (current != null) {
      current.lines.push(line);
    }
  }
  return sections;
}

// The headline for one bullet: its bolded lead-in, or — when a bullet was
// written without one — the first sentence, so the change is still named rather
// than dropped.
function headline(item) {
  const bold = item.match(BOLD_LEAD);
  const raw = bold ? bold[1] : firstSentence(item);
  const text = stripInlineMarkdown(raw).replace(/\s+/g, ' ').trim();
  // A headline that opens with a code span keeps its case: the release notes
  // write those as `clickstack_emerging_signals`, and capitalising renames the
  // thing to something that does not exist.
  return raw.startsWith('`') ? text : capitalise(text);
}

/**
 * @param {string} [changelogMarkdown] Full root CHANGELOG.md contents.
 * @param {{ maxReleases?: number }} [opts]
 * @returns {{ releases: {
 *   version: string,
 *   date?: string,
 *   anchor: string,
 *   title?: string,
 *   summary?: string,
 *   highlights: { kind: 'breaking' | 'feature', text: string }[],
 *   counts: { label: string, count: number }[],
 * }[] }}
 */
function parseWhatsNew(changelogMarkdown, opts = {}) {
  const maxReleases = opts.maxReleases ?? 5;
  const text = changelogMarkdown ?? '';

  // Split on each `## <heading>`, capturing the heading so we can slice the
  // block up to the next one. The file's `# ` title and maintainer preamble sit
  // above the first match and are never read.
  const headingRe = /^##\s+(.+?)\s*$/gm;
  const headings = [...text.matchAll(headingRe)];

  const releases = [];
  for (let i = 0; i < headings.length && releases.length < maxReleases; i++) {
    const heading = headings[i][1].trim();
    const blockStart = headings[i].index + headings[i][0].length;
    const blockEnd =
      i + 1 < headings.length ? headings[i + 1].index : text.length;

    // `v2.36.0 — 2026-08-21`: the leading token is the version, anything after
    // the separator is the release date.
    const [versionToken, ...rest] = heading.split(/\s+—\s+|\s{2,}/);
    const version = versionToken.replace(/^v/i, '');
    const date = rest.join(' ').trim() || undefined;

    const block = text.slice(blockStart, blockEnd);
    const { title, summary } = toPreamble(block);

    const highlights = [];
    const counts = [];
    for (const section of toSections(block)) {
      if (IGNORED_SECTION.test(section.heading)) continue;
      const items = toItems(section.lines);
      const highlighted = HIGHLIGHT_SECTIONS.find(s =>
        s.pattern.test(section.heading),
      );
      if (highlighted) {
        for (const item of items) {
          const headlineText = headline(item);
          if (headlineText) {
            highlights.push({ kind: highlighted.kind, text: headlineText });
          }
        }
      } else if (items.length > 0) {
        counts.push({ label: countLabel(section.heading), count: items.length });
      }
    }

    releases.push({
      version,
      ...(date ? { date } : {}),
      anchor: githubAnchor(heading),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      highlights,
      counts,
    });
  }

  return { releases };
}

module.exports = parseWhatsNew;
