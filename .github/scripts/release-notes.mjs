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

// A release heading, used to confirm a section runs to the next release rather
// than to some other H2.
const RELEASE_HEADING_RE = /^## v(\d+\.\d+\.\d+)/;

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
    return {
      text,
      version: marker?.[1] ?? null,
      inputs: marker?.[2] ?? null,
      // The version as written in the heading, which survives a maintainer
      // deleting the marker. Kept separate from `version` so a marker-less
      // section still fails an inputs-keyed lookup.
      headingVersion: text.match(RELEASE_HEADING_RE)?.[1] ?? null,
    };
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
  // A non-release `## ` heading below the newest release splits a published
  // release in two, and the tail carries real release notes. Dropping it would
  // delete them silently, so refuse to splice and let a human sort it out.
  const newestRelease = sections.findIndex(s => s.headingVersion !== null);
  const orphan = sections.findIndex(
    (s, i) => i > newestRelease && s.headingVersion === null,
  );
  if (orphan !== -1) {
    throw new Error(
      `Refusing to splice: "${sections[orphan].text.split('\n')[0]}" is not a ` +
        `release heading and sits inside published release notes. Fold it into ` +
        `the section above (use ### or deeper) and re-run.`,
    );
  }
  // Match on the heading as well as the marker. A section whose marker a
  // maintainer deleted parses as version:null, and filtering on the marker
  // alone would keep it — leaving two sections for the same version that no
  // later run ever cleans up.
  const kept = sections.filter(
    s =>
      s.version !== version &&
      s.headingVersion !== version &&
      // Drop a non-release section sitting above every release: it renders in
      // the in-app modal as though it were a release, and extractSection
      // rejects the section it splits so it would never be replaced. Anything
      // below the newest release already threw above.
      s.headingVersion !== null,
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
// Kept in sync with ALLOWED_LINK_HOSTS in
// packages/app/src/components/AppNav/ChangelogModal.tsx, and pinned there by a
// test. Exported for that test.
export const ALLOWED_LINK_HOSTS = new Set(['github.com', 'docs.hyperdx.io']);

// Deliberately the same algorithm as allowChangelogUrl in ChangelogModal.tsx:
// parse, then compare the whole hostname. A prefix regex disagrees with the
// render gate on forms like `https://github.com:443/x` and
// `https://user@github.com/x`, which would redden the publish job for content
// that renders correctly.
function linkAllowed(target) {
  try {
    // The base makes a relative target resolve to a host that is never allowed,
    // rather than throwing.
    const parsed = new URL(target, 'https://disallowed.invalid');
    return (
      parsed.protocol === 'https:' && ALLOWED_LINK_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// Replace fenced and indented code blocks with blank lines, preserving line
// count so the structural checks below cannot fire on a legitimate example.
// A fenced YAML snippet opening with `---`, or a snippet containing `## `,
// renders fine and must not fail the publish job.
// Returns the blanked prose plus whatever fence was still open at the end. An
// unclosed fence blanks every remaining line, which would silently switch off
// every prose check below for the rest of the body, so the caller fails on it.
function blankCodeBlocks(text) {
  let fence = null;
  const prose = text
    .split('\n')
    .map(line => {
      const open = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        // CommonMark: a closer uses the same character, runs at least as long
        // as the opener, and carries nothing but whitespace after it. Matching
        // on the first character alone let any ``` line close a ```` fence,
        // which put the rest of that block through the prose checks.
        if (
          open &&
          open[1][0] === fence[0] &&
          open[1].length >= fence.length &&
          /^\s{0,3}(`{3,}|~{3,})\s*$/.test(line)
        ) {
          fence = null;
        }
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
  return { prose, unclosedFence: fence };
}

// Blank the contents of inline code spans, preserving line structure. GitHub
// renders `` `<input>` `` and `` `# not a heading` `` as literal text, so a
// check that fires on them reddens the publish job for legitimate prose.
function blankInlineCode(text) {
  return text.replace(/(`+)(?:(?!\1)[\s\S])*\1/g, m =>
    m.replace(/[^\n]/g, ' '),
  );
}

export function validateBody(body) {
  const errors = [];
  const fail = m => errors.push(m);
  // Structural checks run over prose only; link and image checks run over the
  // whole body, since a link inside a fence still needs to be legitimate if it
  // is ever copied out.
  const { prose, unclosedFence } = blankCodeBlocks(body);
  // Checks whose construct only renders outside a code span or block.
  const proseNoCode = blankInlineCode(prose);

  if (!body.trim()) fail('Body is blank.');
  // Everything after an unopened-but-never-closed fence is blanked above, so
  // without this the checks over `prose` silently pass on the rest of the body.
  if (unclosedFence) {
    fail(`Body has an unclosed \`${unclosedFence}\` code fence.`);
  }
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
  if (body.includes(PACKAGE_LIST_START) || body.includes(PACKAGE_LIST_END)) {
    fail('Body contains a package-list marker; the publish step owns those.');
  }
  // Checked against the RAW body, not `prose`. parseChangelog splits sections on
  // any line starting with `## ` with no fence awareness, so a `## ` inside a
  // code fence would be accepted here and then split the section in two on
  // splice. The two must agree, and making parseChangelog fence-aware is the
  // worse option: an unclosed fence would blank the rest of the file and drop
  // real sections. So no `##` anywhere, fenced or not.
  //
  // CommonMark allows an ATX heading indented up to three spaces and delimited
  // by a tab, so `   ## v9.9.9` renders as a real <h2> while `^## ` misses it.
  if (/^[ \t]{0,3}#{2}[ \t]/m.test(body)) {
    fail('Body contains an H2 heading (even inside a code fence); use ###.');
  }
  // An H1 has no such constraint — parseChangelog ignores it — so a `# comment`
  // line in a fenced config example is legitimate and only prose is checked.
  if (/^[ \t]{0,3}#[ \t]/m.test(proseNoCode)) {
    fail('Body contains an H1 heading; use ###.');
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
  // Raw HTML. react-markdown ignores it (no rehype-raw), but GitHub renders the
  // committed CHANGELOG.md with these allowed, and `<img src>` carries no `](`
  // so every link and image rule above misses it. Named rather than a blanket
  // `<[a-z]`, which would trip on prose like `Map<string, string>`. Checked over
  // prose: `` `<input>` `` and a fenced HTML example both render as text.
  if (
    /<\/?(a|img|script|iframe|svg|object|embed|style|form|input|link|meta|video|audio|source|base)\b/i.test(
      proseNoCode,
    )
  ) {
    fail('Body contains raw HTML; use markdown.');
  }
  // Bare autolinks are CommonMark and carry no `](`.
  if (/<[a-z][a-z0-9+.-]*:/i.test(proseNoCode)) {
    fail('Body contains an autolink; use inline [text](url) links.');
  }
  for (const [, target] of body.matchAll(/\]\(([^)\s]*)/g)) {
    if (!linkAllowed(target)) {
      fail(`Disallowed link target: ${target}`);
    }
  }
  // A bare URL carries no `](` and no `<`, but GitHub autolinks it in the
  // committed changelog and in the release PR diff. Only the absence of
  // remark-gfm keeps it inert in the in-app modal.
  for (const [url] of proseNoCode.matchAll(/https?:\/\/[^\s)<>\]]+/gi)) {
    if (!linkAllowed(url)) fail(`Disallowed URL in prose: ${url}`);
  }
  return errors;
}

// The heading the workflow appends the per-package list under. Stripped before
// a fresh list is appended, because the reuse path hands back a previously
// published body that already carries one.
export const PACKAGE_LIST_HEADING = '### 📦 Package changelogs';
export const PACKAGE_LIST_START = '<!-- hyperdx-package-list -->';
export const PACKAGE_LIST_END = '<!-- /hyperdx-package-list -->';

// Strip only between the markers. Slicing from the heading to end-of-body would
// silently delete anything a maintainer wrote below the generated list.
export function stripPackageList(body) {
  const tidy = body.trimEnd() + '\n';
  const start = body.indexOf(PACKAGE_LIST_START);
  const end = body.indexOf(PACKAGE_LIST_END, start === -1 ? 0 : start);
  if (start === -1 && end === -1) return tidy;
  // One marker deleted by hand. There is no unambiguous end to cut to, and
  // cutting to end-of-body would take a maintainer's text with it, so change
  // nothing: validateBody rejects the leftover marker, which the reuse path
  // reads as a cache miss and regenerates with this text as context.
  if (end === -1) {
    console.error('::warning::Package-list end marker missing; not stripping.');
    return tidy;
  }
  // Start marker deleted but the heading survived: the heading is where the
  // generated block begins, so that is a safe cut.
  const from =
    start !== -1 ? start : body.lastIndexOf(PACKAGE_LIST_HEADING, end);
  if (from === -1) {
    console.error(
      '::warning::Package-list start marker and heading missing; not stripping.',
    );
    return tidy;
  }
  const after = body.slice(end + PACKAGE_LIST_END.length);
  return (body.slice(0, from).trimEnd() + '\n' + after.trim()).trimEnd() + '\n';
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
  if (cmd === 'latest-version') {
    requireArgs(args, ['changelog']);
    const c = existsSync(args.changelog)
      ? readFileSync(args.changelog, 'utf-8')
      : null;
    // Fall back to the heading. Deleting the marker is the one edit the design
    // explicitly anticipates, and without the fallback this exits 2, which the
    // caller reads as "no previous section" and then hands the already-released
    // section to the generator as this release's prior text.
    const newest = c === null ? null : parseChangelog(c).sections[0];
    const version = newest?.version ?? newest?.headingVersion;
    if (!version) process.exit(2);
    process.stdout.write(version);
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
      'Usage: release-notes.mjs insert|extract|validate|latest-version|strip-package-list --changelog <path> [--body <path>] --version <v> --inputs <hash> [--date <YYYY-MM-DD>] [--latest]',
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
