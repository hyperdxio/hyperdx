## Summary

<!--
Describe what changed and why.
Write for reviewers who may not be familiar with this area of the product.
-->

### Screenshots or video

<!--
Required for any PR that changes something visible in the UI. Before is main,
after is this branch: same screen, data, viewport, and theme. Use a short video
for interactions. For a brand new screen, show where it's reached from as
"Before". See CONTRIBUTING.md#ui-changes-need-beforeafter-screenshots.

Omit this section if the PR does not contain any UI changes.
-->

| Before | After |
| :----- | :---- |
|        |       |

### How to reproduce

<!--
Steps a reviewer can follow to see the problem on main and the fix on this
branch. Start from play.hyperdx.io where possible, or `yarn app:dev:local`
connected to the demo server (onboarding → "Connect to Demo Server"); the
Vercel preview on this PR runs the same local mode. Use `yarn dev` only when
the change needs the API (alerts, webhooks, auth, teams). Name UI
elements by their visible text. List any env vars, feature flags, schema, or
seed data needed. Linking an issue that already has repro steps is fine.
See CONTRIBUTING.md#reproducing-issues-and-prs.
-->

**Starting point:**

<!-- play.hyperdx.io URL, or local dev + demo server, or your own setup (describe it) -->

**On `main`:**

1.

**On this branch:**

1.

### How to test on Vercel preview

<!--
This section is consumed by the UI preview smoke-test agent
(.github/workflows/ui-preview-smoke.yml). For PRs touching packages/app,
fill it in carefully — the agent executes these steps verbatim against
the Vercel preview build (LOCAL_MODE, demo ClickHouse pre-configured).

Format:
  - Preview routes: comma-separated paths to open (e.g. /search, /chart).
  - Steps: numbered imperative actions, one per line. Reference UI elements
    by visible text or data-testid. The last step on each route should be
    an assertion ("Verify ...", "Confirm ...").
  - Skip this section (leave blank or write "N/A — non-UI change") if the
    PR does not change anything user-visible.
-->

**Preview routes:** <!-- e.g. /chart, /dashboards/[id] -->

**Steps:**

1.
2.
3.

### References

<!--
Add any supporting references that help reviewers understand this PR.
Examples: issue/ticket or related PRs.
-->

- Linear Issue:
- Related PRs:
