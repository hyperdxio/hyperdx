// Manages AI-generated release sections in the root CHANGELOG.md.
// Each section is identified by an HTML-comment marker so the release
// workflow can tell whether an existing (possibly human-edited) section was
// generated from the same set of changesets and reuse it instead of
// regenerating. See .github/workflows/release.yml (release_changelog job).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Kept byte-for-byte in sync with the committed root CHANGELOG.md (which
// prettier owns the wrapping of) so the scaffold-when-missing path can never
// produce a file that differs from the seed.
const HEADER = `# HyperDX Changelog

Release-level highlights across all HyperDX packages. Each entry is AI-generated
during the release and reviewed (and freely editable) in the "Release HyperDX"
PR — keep the \`hyperdx-release-notes\` comment marker intact when editing so your
edits survive regeneration. Per-package detail lives in each
\`packages/*/CHANGELOG.md\`.
`;

const MARKER_RE =
  /^<!-- hyperdx-release-notes version=(\S+) inputs=(\S+) -->$/m;

// Same marker, matched a line at a time so the body can be extracted without
// depending on how many blank lines prettier put around it.
const MARKER_LINE_RE = /^<!-- hyperdx-release-notes .* -->$/;

function parseChangelog(content) {
  const lines = content.split('\n');
  const headingIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) headingIdxs.push(i);
  }
  const header = lines.slice(0, headingIdxs[0] ?? lines.length).join('\n');
  const sections = headingIdxs.map((start, n) => {
    const end = headingIdxs[n + 1] ?? lines.length;
    const text = lines.slice(start, end).join('\n');
    const marker = text.match(MARKER_RE);
    return { text, version: marker?.[1] ?? null, inputs: marker?.[2] ?? null };
  });
  return { header, sections };
}

// A release heading, used to confirm a section runs to the next release rather
// than to some other H2.
const RELEASE_HEADING_RE = /^## v\d+\.\d+\.\d+/;

export function insertSection(content, { version, inputs, date, body }) {
  // A blank file counts as missing: the capture step in release.yml can leave a
  // zero-byte CHANGELOG.md behind when `git show` finds nothing.
  const { header, sections } = parseChangelog(
    content?.trim() ? content : HEADER,
  );
  // Blank line after the heading: this is the shape prettier normalises to, so
  // emitting it directly keeps CI-written files formatting-clean.
  const section = [
    `## v${version} — ${date}`,
    '',
    `<!-- hyperdx-release-notes version=${version} inputs=${inputs} -->`,
    '',
    body.trim(),
  ].join('\n');
  // Match on the heading as well as the marker. A section whose marker a
  // maintainer deleted parses as version:null, and filtering on the marker
  // alone would keep it — leaving two sections for the same version that no
  // later run ever cleans up.
  const headingPrefix = `## v${version} `;
  const kept = sections.filter(
    s =>
      s.version !== version &&
      !s.text.startsWith(headingPrefix) &&
      // Drop anything that is not a release section. A `## ` heading added by
      // hand would otherwise persist forever: extractSection rejects the
      // section it splits, so it is never replaced, and it renders in the
      // in-app modal as though it were a release.
      RELEASE_HEADING_RE.test(s.text),
  );
  return (
    [header.trimEnd(), section, ...kept.map(s => s.text.trimEnd())].join(
      '\n\n',
    ) + '\n'
  );
}

// `latest: true` returns the newest section whatever its version. The release
// version changes whenever a new changeset raises the bump level, so a
// version-keyed lookup misses exactly when regeneration is triggered — which is
// the moment the maintainer's previous prose is most worth handing to the
// generator as context.
export function extractSection(content, { version, inputs, latest }) {
  if (content == null) return null;
  const { sections } = parseChangelog(content);
  const idx = latest
    ? 0
    : sections.findIndex(
        s =>
          s.version === version &&
          (inputs === undefined || s.inputs === inputs),
      );
  const match = idx === -1 ? undefined : sections[idx];
  if (!match) return null;
  // A `## ` heading added mid-section by a maintainer ends the section early:
  // parseChangelog would hand back a body truncated at that heading while the
  // tail became a version-less orphan. Treat that as a miss so the caller
  // regenerates instead of silently publishing half a section.
  const next = sections[idx + 1];
  if (next && !RELEASE_HEADING_RE.test(next.text)) return null;
  // Drop the heading and the marker line; return the body only. Matched by
  // pattern rather than position because prettier reflows the blank lines
  // around them whenever a maintainer edits the file locally.
  const body = match.text
    .split('\n')
    .slice(1)
    .filter(line => !MARKER_LINE_RE.test(line))
    .join('\n')
    .trim();
  return body + '\n';
}

// Fail-fast checks on a model-authored body, before it is spliced into the
// committed changelog. These are NOT the security boundary — regexes cannot be
// complete over CommonMark. ChangelogModal.tsx holds the enforceable check: it
// drops image nodes and allowlists link targets on react-markdown's parsed AST,
// so no syntax can smuggle either into the in-app modal. What lives here is
// early, legible feedback in CI (the changelog jobs run without node_modules,
// so a real markdown parser is not available to them).
const MAX_BODY_BYTES = 65536;
// Mirrors allowChangelogUrl in packages/app/.../ChangelogModal.tsx. The CI gate
// must never be stricter than the render gate, or the publish job reddens for
// content that would have rendered correctly — `https://docs.hyperdx.io` with
// no trailing slash being the obvious case.
const ALLOWED_LINK_PREFIX_RE =
  /^https:\/\/(github\.com|docs\.hyperdx\.io)([/?#]|$)/i;

// Replace fenced and indented code blocks with blank lines, preserving line
// count so the structural checks below cannot fire on a legitimate example.
// A fenced YAML snippet opening with `---`, or a snippet containing `## `,
// renders fine and must not fail the publish job.
function blankCodeBlocks(text) {
  let fence = null;
  return text
    .split('\n')
    .map(line => {
      const open = line.match(/^\s{0,3}(```+|~~~+)/);
      if (fence) {
        const closed = open && line.trim().startsWith(fence[0]);
        if (closed) fence = null;
        return '';
      }
      if (open) {
        fence = open[1];
        return '';
      }
      // Indented code block (four spaces or a tab).
      return /^(\t| {4})/.test(line) ? '' : line;
    })
    .join('\n');
}

export function validateBody(body) {
  const errors = [];
  const fail = m => errors.push(m);
  // Structural checks run over prose only; link and image checks run over the
  // whole body, since a link inside a fence still needs to be legitimate if it
  // is ever copied out.
  const prose = blankCodeBlocks(body);

  if (!body.trim()) fail('Body is blank.');
  if (Buffer.byteLength(body, 'utf-8') > MAX_BODY_BYTES) {
    fail(`Body exceeds ${MAX_BODY_BYTES} bytes.`);
  }
  // The drafting process holds ANTHROPIC_API_KEY alongside attacker-influenceable
  // changeset and PR text, and this body is committed to a public branch.
  if (/sk-ant-|gh[psoru]_[A-Za-z0-9]{16,}|github_pat_/.test(body)) {
    fail('Body contains something shaped like a credential.');
  }
  if (/hyperdx-release-notes/.test(body)) {
    fail('Body contains a release-notes marker; the splice owns those.');
  }
  // CommonMark allows an ATX heading indented up to three spaces and delimited
  // by a tab, so `   ## v9.9.9` renders as a real <h2> while `^## ` misses it.
  if (/^[ \t]{0,3}#{1,2}[ \t]/m.test(prose)) {
    fail('Body contains an H1/H2 heading; the splice owns those. Use ###.');
  }
  // Setext underlines forge an H2 without any leading `#`.
  if (/^[ \t]{0,3}(=+|-{2,})[ \t]*$/m.test(prose)) {
    fail('Body contains a setext heading underline.');
  }
  // Any image syntax: inline `![x](…)`, reference `![x][r]`, shortcut `![x]`.
  if (/!\[[^\]]*\]/.test(body)) {
    fail('Body contains an image; not permitted in release notes.');
  }
  // Reference definitions, whose target may sit on the following line.
  if (/^[ \t]{0,3}\[[^\]]+\]:/m.test(prose)) {
    fail('Body uses reference-style links; use inline links only.');
  }
  // Bare autolinks are CommonMark and carry no `](`.
  if (/<[a-z][a-z0-9+.-]*:/i.test(body)) {
    fail('Body contains an autolink; use inline [text](url) links.');
  }
  for (const [, target] of body.matchAll(/\]\(([^)\s]*)/g)) {
    if (!ALLOWED_LINK_PREFIX_RE.test(target)) {
      fail(`Disallowed link target: ${target}`);
    }
  }
  return errors;
}

// The heading the workflow appends the per-package list under. Stripped before
// a fresh list is appended, because the reuse path hands back a previously
// published body that already carries one.
export const PACKAGE_LIST_HEADING = '### 📦 Package changelogs';

export function stripPackageList(body) {
  const idx = body.indexOf(PACKAGE_LIST_HEADING);
  return (idx === -1 ? body : body.slice(0, idx)).trimEnd() + '\n';
}

const BOOLEAN_FLAGS = new Set(['latest']);

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag?.startsWith('--')) throw new Error(`Bad argument: ${flag}`);
    const name = flag.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      args[name] = true;
      continue;
    }
    if (argv[i + 1] === undefined) throw new Error(`Bad argument: ${flag}`);
    args[name] = argv[++i];
  }
  return args;
}

function requireArgs(args, names) {
  const missing = names.filter(n => !args[n]);
  if (missing.length) {
    throw new Error(
      `Missing required flag(s): ${missing.map(n => `--${n}`).join(', ')}`,
    );
  }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  // These subcommands operate on --body alone and need no changelog.
  if (cmd === 'strip-package-list') {
    requireArgs(args, ['body']);
    writeFileSync(
      args.body,
      stripPackageList(readFileSync(args.body, 'utf-8')),
    );
    return;
  }
  if (cmd === 'validate') {
    requireArgs(args, ['body']);
    const errors = validateBody(readFileSync(args.body, 'utf-8'));
    if (errors.length) {
      for (const e of errors) console.error(`::error::${e}`);
      process.exit(1);
    }
    return;
  }
  const content = existsSync(args.changelog)
    ? readFileSync(args.changelog, 'utf-8')
    : null;
  if (cmd === 'insert') {
    // Without this an omitted --date silently writes "## v1.0.0 — undefined"
    // into the committed changelog.
    requireArgs(args, ['changelog', 'body', 'version', 'inputs', 'date']);
    const body = readFileSync(args.body, 'utf-8');
    writeFileSync(args.changelog, insertSection(content, { ...args, body }));
  } else if (cmd === 'extract') {
    // Without this an omitted --changelog exits 2, which the workflow reads as
    // a routine cache miss rather than a misconfiguration.
    requireArgs(args, ['changelog']);
    const body = extractSection(content, args);
    // An emptied-out body counts as a miss. Otherwise the reuse path — which
    // runs no validation of its own — would republish a heading with no
    // content instead of falling through to regeneration.
    if (body === null || body.trim() === '') process.exit(2);
    process.stdout.write(body);
  } else {
    console.error(
      'Usage: release-notes.mjs insert|extract|validate|strip-package-list --changelog <path> [--body <path>] --version <v> --inputs <hash> [--date <YYYY-MM-DD>] [--latest]',
    );
    process.exit(1);
  }
}

// argv[1] is undefined when this module is imported from `node -e`/`node -p`.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
