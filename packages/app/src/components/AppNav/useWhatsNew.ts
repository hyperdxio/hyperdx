import { useRouter } from 'next/router';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';

const REPO_URL = 'https://github.com/hyperdxio/hyperdx';

/**
 * Link to the root changelog — the release-level summary written during each
 * release — as it stood at `version`.
 *
 * Pinned to that release's tag rather than `main`: merging to main does not
 * deploy, so main's changelog describes whatever has been released since, and a
 * deployment several releases behind would link users to notes for versions it
 * is not running.
 *
 * The version comes from the release being linked, which is a release that
 * actually shipped, so the tag exists — unlike the running build's own version,
 * which mid-cycle is a version no tag was ever cut for. Falls back to main only
 * when there is no release to key on (the "unable to load" branch).
 *
 * Points at the file, not the Releases page: releases are cut per-package, which
 * scatters the notes for one release across several tags.
 */
export const changelogUrl = (version?: string) =>
  version
    ? `${REPO_URL}/blob/${encodeURIComponent(
        `@hyperdx/app@${version}`,
      )}/CHANGELOG.md`
    : `${REPO_URL}/blob/main/CHANGELOG.md`;

// Generated from CHANGELOG.md at build time (see next.config.mjs) and shipped as
// a static asset so we don't fetch the whole, ever-growing changelog.
const WHATS_NEW_FILE = 'whats-new.json';

// Validated rather than cast: the payload is a static file that a stale CDN
// copy, a proxy error page, or a botched build can turn into something that
// parses as JSON but isn't this shape. Without the check, a response missing
// `releases` leaves `data.releases` undefined, which both consumers read as
// "still loading" — an indefinite spinner with no error branch. Failing the
// query instead routes it to the existing "Unable to load" fallback.
// One headline from the release notes' breaking-changes or new-features list.
const whatsNewHeadlineSchema = z.object({
  kind: z.enum(['breaking', 'feature']),
  text: z.string(),
});

// The sections we don't list out (improvements, fixes, and anything the release
// notes add later) reduced to "N <label>".
const whatsNewCountSchema = z.object({
  label: z.string(),
  count: z.number(),
});

const whatsNewReleaseSchema = z.object({
  version: z.string(),
  date: z.string().optional(),
  // The release's heading anchor on GitHub, for deep-linking its counts.
  anchor: z.string(),
  // The headline and summary the release notes open with. Optional: releases
  // written before the notes carried a headline have neither.
  title: z.string().optional(),
  summary: z.string().optional(),
  highlights: z.array(whatsNewHeadlineSchema),
  counts: z.array(whatsNewCountSchema),
});

// Exported for the contract test that runs the build-time parser's real output
// through it — the two are written in different languages in different
// directories, and a shape they disagree on means "Unable to load" for everyone.
export const whatsNewSchema = z.object({
  releases: z.array(whatsNewReleaseSchema),
});

// Only the top-level type is exported — the consumers reach the nested shapes
// through it, and knip flags exports nothing imports.
export type WhatsNew = z.infer<typeof whatsNewSchema>;

// "12 bug fixes" needs the singular at 1, and the labels come from the release
// notes' own headings rather than a fixed list.
//
// ponytail: three regexes, not an inflector library — the labels in practice are
// "improvements", "bug fixes", "experimental" and "build / packaging". Reach for
// a real one if the release notes ever grow an irregular plural.
const singularise = (label: string) =>
  label
    .replace(/ies$/, 'y')
    .replace(/(x|s|ch|sh)es$/, '$1')
    .replace(/([^s])s$/, '$1');

export const formatCounts = (counts: { label: string; count: number }[]) => {
  const parts = counts.map(
    ({ label, count }) =>
      `${count} ${count === 1 ? singularise(label) : label}`,
  );
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

// Shared query for the bounded "what's new" payload. Both the Help-menu peek and
// the drawer use the same key so they share one fetch/cache; `enabled` gates it
// so we only fetch once something that needs it is actually opened.
export const useWhatsNew = (enabled: boolean) => {
  const { basePath } = useRouter();

  return useQuery<WhatsNew>({
    enabled,
    queryKey: ['whats-new', basePath],
    staleTime: Infinity,
    // A static asset that 404s won't start existing on retry, and the default
    // 3 retries just delay the fallback behind backoff.
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${basePath}/${WHATS_NEW_FILE}`);
      if (!res.ok) {
        throw new Error(`Failed to load what's new: ${res.status}`);
      }
      return whatsNewSchema.parse(await res.json());
    },
  });
};
