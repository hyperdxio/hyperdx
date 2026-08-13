---
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Show password requirements on the Join Team page and align the checklist with the server policy. When a user accepts a team invite and sets their password, the same live password policy checklist used on the auth/register page is now displayed, so users no longer have to guess the required length, casing, number, and special-character rules. The checklist previously diverged from the server in two ways that could show all-green checks for a password the server rejects: its special-character rule used a broader pattern than the backend (so a password whose only special character was e.g. `~`, a backtick, or a space passed the checklist but failed on submit), and it never surfaced the 72-character maximum (so an over-long password passed the checklist but failed on submit). The length rule now enforces both the minimum and maximum, and the password policy checks (length bounds, casing, number, and the accepted special-character set) live in a single shared module in `@hyperdx/common-utils` used by both the frontend checklist and the backend `passwordSchema`, so they can no longer drift.
