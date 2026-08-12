/**
 * The HyperDX Labs registry — the single source of truth for which experiments
 * exist and how they're described to users.
 *
 * Adding a lab is intended to be a one-file change: add an entry here, then
 * gate your feature with `useIsLabEnabled('your-id')`. No API change, no schema
 * change, no migration. Read agent_docs/labs.md before adding one — in
 * particular the graduate-or-retire rule, which is what keeps this file from
 * accumulating zombie flags.
 */

export type Lab = {
  /**
   * Stable kebab-case id, validated by `LabIdSchema` in common-utils. This is
   * persisted on the user document, so changing it silently resets everyone's
   * opt-in — treat it as permanent once shipped.
   */
  id: string;
  /** Short, user-facing name. Sentence case. */
  title: string;
  /**
   * What it does *and* what's still rough. Someone opting into unfinished work
   * deserves to know where the edges are, so prefer "Span links aren't drawn
   * yet and wide traces are slow" over "improved trace view".
   */
  description: string;
  /** Optional maturity hint shown next to the title, e.g. 'Alpha', 'Beta'. */
  badge?: string;
  /** ISO day (YYYY-MM-DD). Drives the graduate-or-retire sweep. */
  addedAt: string;
  /** Who decides this lab's fate. GitHub or Slack handle. */
  owner: string;
};

/**
 * Deliberately empty. This ships the mechanism, not any experiments.
 *
 * Typed as `readonly Lab[]` rather than `[...] as const satisfies readonly
 * Lab[]`. The const form is tempting because it would narrow lab ids to a
 * literal union, making a deleted entry a compile error at every gate. But on
 * an *empty* registry that union is `never`: every `lab.id` in a `.map` fails
 * to typecheck, and `useIsLabEnabled` becomes uncallable, including from its
 * own tests. Retirement is covered instead by the documented step of grepping
 * for the id after deleting the entry — see agent_docs/labs.md. Worth
 * revisiting once a few labs exist and the empty case is behind us.
 */
export const LABS: readonly Lab[] = [];
