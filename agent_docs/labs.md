# HyperDX Labs

Per-user, server-persisted opt-ins for features that aren't finished yet.

The point is to stop choosing between a long-lived branch and a redeploy. Merge
the half-built thing to `main` behind a lab, let the people who want it turn it
on, and collect feedback while you finish. Off by default, so nobody is
surprised.

**Labs are a user choice.** If the toggle is really a deployment decision — this
install doesn't have the backend, or the feature is off everywhere until launch —
it isn't a lab, it's a constant in `packages/app/src/config.ts` next to
`IS_MTVIEWS_ENABLED`.

## Adding a lab

Two edits. Add an entry to `packages/app/src/labs/registry.ts`:

```ts
export const LABS: readonly Lab[] = [
  {
    id: 'trace-flamegraph',
    title: 'Trace flamegraph',
    description:
      'Renders the trace waterfall as a flamegraph. Span links are not drawn yet, and very wide traces can be slow to lay out.',
    badge: 'Alpha',
    addedAt: '2026-08-14',
    owner: '@your-handle',
  },
];
```

Then gate the feature:

```ts
import { useIsLabEnabled } from '@/labs/useLabs';

const isFlamegraphEnabled = useIsLabEnabled('trace-flamegraph');
...
{isFlamegraphEnabled ? <TraceFlamegraph … /> : <TraceWaterfall … />}
```

No API change, no schema change, no migration, no new endpoint. The server
stores whatever ids the client sends (bounded — see below), so it never needs to
learn about your lab.

Write the `description` for someone deciding whether to opt in. Say what's rough,
not just what's new: "span links aren't drawn yet" beats "improved trace view".

### Checklist

- `id` is kebab-case (`[a-z0-9]+(-[a-z0-9]+)*`) and permanent. It's persisted on
  the user document, so renaming it silently resets everyone's opt-in.
- `addedAt` is today, `owner` is you. Both feed the graduate-or-retire sweep.
- Add an E2E test that toggles the lab, reloads, and asserts it stuck.
  `packages/app/tests/e2e/components/LabsModalComponent.ts` has `setLab(id, on)`
  (clicks and waits for the PATCH) and `labSwitch(id)` (the input, for
  `toBeChecked()`) waiting for exactly this. Both were verified against a
  throwaway entry, but the committed suite only covers the empty state, so yours
  will be the first run in CI.
- A changeset, if the lab is visible to users at all.

## Gating rules

`useIsLabEnabled(id)` returns `false` when the user hasn't opted in and while the
stored set is still loading. Two consequences worth knowing:

**The loading window is real** (outside local mode). `/me` isn't resolved on
first paint — `AuthLoadingBlocker` is only mounted on the landing page, so it
does not gate the app. A lab therefore reads OFF and then flips ON a moment
later. For the common shape (an extra tab, an extra button, an alternate
renderer) that's fine. If the flip is user-visible — a redirect, a default tab, a
one-shot effect, a mount-time fetch — use `useLabs()` and branch on `isLoading`
first:

```ts
const { enabled, isLoading } = useLabs();
if (isLoading) return <Skeleton />;
```

**Labs are available everywhere, including local mode**, so there is no
deployment flag to flip and no environment where the menu entry is missing. Local
mode has no API server and no user identity, so opt-ins there live in
localStorage under `hdx-labs` instead of on the user document. That branch is
confined to `useLabs.ts`; nothing else needs to know which store is in play.

What local mode does *not* change: whether your feature can actually run. If it
needs a backend, gate on that too, the way `IS_IAC_EXPORT_ENABLED` does:

```ts
const isEnabled = useIsLabEnabled('remote-mtviews') && !IS_LOCAL_MODE;
```

Now that a lab can be switched on in local mode, this is load-bearing rather
than decorative — without it, a local-mode user can opt into something that
cannot work. Add it whenever the feature depends on the API server.

## Graduating and retiring

**A lab is a commitment to decide, not a commitment to ship.** About 60 days
after `addedAt`, the owner picks one of two exits. "Leave it in Labs" is not an
exit — that's how you end up with fourteen flags nobody can explain.

- **Graduate** — delete the registry entry, delete the gate, keep the new branch
  of the conditional.
- **Retire** — delete the registry entry, delete the gate, delete the feature.

Either way: **after deleting the entry, grep for the id.** A gate whose id has no
registry entry silently reads `false` forever, so nothing breaks loudly — the
gated code just goes dead and stays in the tree. The grep is the whole retirement
checklist.

Stored `true` values for a deleted id go inert immediately (the hook derives
state from the registry, not from what's stored) and are pruned from the document
the next time that user toggles anything. No migration, no cleanup job.

Enforcement is a review habit, not CI. A date-based test would fail on somebody
else's unrelated PR at 2am and get its constant bumped within the hour. The
registry is one short file — reading it is a 30-second sweep, and that
single-file-ness is the actual anti-rot mechanism.

## How it works

| Piece | Where |
| --- | --- |
| Registry (ids + UI copy) | `packages/app/src/labs/registry.ts` |
| Hook — the only seam | `packages/app/src/labs/useLabs.ts` |
| Modal (nav user menu) | `packages/app/src/labs/LabsModal.tsx` |
| Storage | `labs` on the `User` document, `packages/api/src/models/user.ts` |
| Read / write | `GET /me` and `PATCH /me/labs`, `packages/api/src/routers/api/me.ts` |
| Local-mode storage | `hdx-labs` in localStorage, via the atom in `useLabs.ts` |
| Shape contract | `UserLabsSchema` in `packages/common-utils/src/types.ts` |

There is no deployment flag. Labs is always present; individual labs are what
get toggled.

State is an **enabled-set**: a key present with `true` is on, an absent key is
off. Writes are **full replace** — the client always holds the whole registry, so
it can always compute the complete desired set, and that's what makes retired ids
self-pruning.

**The server validates shape, not ids.** It bounds the key format (kebab-case,
which also excludes `$`, `.` and `_`, so Mongo operators, dotted paths and
`__proto__` can't be keys) and the entry count, but it deliberately does not know
which labs exist — that's what keeps adding one to a single file. The trade-off:
a typo'd id can't be rejected server-side, so
`packages/app/src/labs/__tests__/registry.test.ts` parses every registry id
against `LabIdSchema` to catch `my_lab` or `My-Lab` at CI time instead of as a
mystery 400.

Reads compare `=== true` rather than truthiness, because a key like `constructor`
passes the id regex and is inherited from `Object.prototype`, where it's truthy.

**Multi-tab / multi-device:** a toggle is visible immediately in the tab you
clicked it in (the mutation is optimistic), in other tabs on next focus, and on
other devices on next load. Two tabs toggling *different* labs from the same
snapshot can lose one — full replace is last-write-wins. The cost is "flip it
again"; if that ever stops being acceptable, merge server-side in `setUserLabs`.
In local mode there is nothing to sync: the choice stays in that browser.

## Related

`packages/app/src/hooks/useIsVariablesEnabled.ts` predates this and is the
clearest example of what labs are for: an env-var toggle
(`NEXT_PUBLIC_ENABLE_DASHBOARD_VARIABLES`) shipped because variable substitution
wasn't implemented yet, wrapped in a hook whose `isLoading: false` was left in
place, per its own comment, "to support team-level toggle loading in the future."
That's the shape `useLabs` now provides — a good first graduation candidate.
