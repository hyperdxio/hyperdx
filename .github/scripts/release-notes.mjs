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
    s => s.version !== version && !s.text.startsWith(headingPrefix),
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
  const match = latest
    ? sections[0]
    : sections.find(
        s =>
          s.version === version &&
          (inputs === undefined || s.inputs === inputs),
      );
  if (!match) return null;
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

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const content = existsSync(args.changelog)
    ? readFileSync(args.changelog, 'utf-8')
    : null;
  if (cmd === 'insert') {
    const body = readFileSync(args.body, 'utf-8');
    writeFileSync(args.changelog, insertSection(content, { ...args, body }));
  } else if (cmd === 'extract') {
    const body = extractSection(content, args);
    // An emptied-out body counts as a miss. Otherwise the reuse path — which
    // runs no validation of its own — would republish a heading with no
    // content instead of falling through to regeneration.
    if (body === null || body.trim() === '') process.exit(2);
    process.stdout.write(body);
  } else {
    console.error(
      'Usage: release-notes.mjs insert|extract --changelog <path> [--body <path>] --version <v> --inputs <hash> [--date <YYYY-MM-DD>]',
    );
    process.exit(1);
  }
}

// argv[1] is undefined when this module is imported from `node -e`/`node -p`.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
