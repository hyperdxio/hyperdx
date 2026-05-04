---
description:
  Fetch a Linear ticket, implement the fix/feature, test, commit, push, and
  raise a PR
---

Look up the Linear ticket $ARGUMENTS. Read the ticket description, comments, and
any linked resources thoroughly.

## Phase 1: Understand the Ticket

- Summarize the ticket — what is being asked for (bug fix, feature, refactor,
  etc.)
- Identify acceptance criteria or expected behavior from the description
- Note any linked issues, related tickets, or dependencies

If the ticket description is too vague or lacks enough information to proceed
confidently, **stop and ask me for clarification** before writing any code.
Explain exactly what information is missing and what assumptions you would need
to make.

## Phase 2: Plan and Implement

Before writing code, read the relevant documentation from the `agent_docs/`
directory to understand architecture and code patterns.

1. Explore the codebase to understand the relevant code paths and existing
   patterns
2. Create an implementation plan — which files to change, what approach to take
3. Implement the fix or feature following existing codebase patterns
4. Keep changes minimal and focused on the ticket scope

## Phase 3: Verify

Run lint and type checks, then run the appropriate tests based on which packages
were modified:

1. Run `make ci-lint` to verify lint and TypeScript types pass
2. Run `make ci-unit` to verify unit tests pass across all packages
3. If any checks fail, fix the issues and re-run until everything passes

## Phase 4: Commit, Push, and Open PR

1. Create a new branch named `<current-user>/$ARGUMENTS-<short-description>`.
   Use the current git/OS username when available, and use `whoami` as a
   fallback to determine the prefix (e.g. `warren/HDX-1234-fix-search-filter`)
2. Commit the changes using conventional commit format (e.g. `feat:`, `fix:`,
   `chore:`) and reference the ticket ID
3. Push the branch to the remote
4. Open a draft pull request with:
   - Title: `[$ARGUMENTS] <description>`. If multiple tickets are being
     addressed, omit the arguments from the title.
   - Body: Use `.github/pull_request_template.md` as the template and fill it in
     with the relevant summary, testing notes, and Linear ticket link
   - Label: Attach the `ai-generated` label
