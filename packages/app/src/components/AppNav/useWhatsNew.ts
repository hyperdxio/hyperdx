import { useRouter } from 'next/router';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';

// The full history lives in the app's changelog on GitHub. Points at the file
// (not the Releases page) because Releases are cut per-package, scattering the
// @hyperdx/app notes among the other packages' tags.
export const CHANGELOG_URL =
  'https://github.com/hyperdxio/hyperdx/blob/main/packages/app/CHANGELOG.md';

// Generated from CHANGELOG.md at build time (see next.config.mjs) and shipped as
// a static asset so we don't fetch the whole, ever-growing changelog.
const WHATS_NEW_FILE = 'whats-new.json';

// Validated rather than cast: the payload is a static file that a stale CDN
// copy, a proxy error page, or a botched build can turn into something that
// parses as JSON but isn't this shape. Without the check, a response missing
// `releases` leaves `data.releases` undefined, which both consumers read as
// "still loading" — an indefinite spinner with no error branch. Failing the
// query instead routes it to the existing "Unable to load" fallback.
const whatsNewHighlightSchema = z.object({
  title: z.string(),
  blurb: z.string(),
  image: z.string().optional(),
});

// A feature headline tagged with its `feat(scope)` (or "general").
const whatsNewFeatureSchema = z.object({
  scope: z.string(),
  text: z.string(),
});

const whatsNewReleaseSchema = z.object({
  version: z.string(),
  features: z.array(whatsNewFeatureSchema),
  highlight: whatsNewHighlightSchema.optional(),
});

const whatsNewSchema = z.object({
  releases: z.array(whatsNewReleaseSchema),
});

// Only the top-level type is exported — the consumers reach the nested shapes
// through it, and knip flags exports nothing imports.
export type WhatsNew = z.infer<typeof whatsNewSchema>;

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
