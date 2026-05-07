## Summary

<!--
Describe what changed and why.
Write for reviewers who may not be familiar with this area of the product.
-->

### Screenshots or video

<!--
If this PR includes UI changes, include screenshots or a short video.
For new features, "Before" can be omitted.

Omit this section if the PR does not contain any UI changes.
-->

| Before | After |
| :----- | :---- |
|        |       |

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
