---
'@hyperdx/app': patch
'@hyperdx/api': patch
---

Show password requirements on the Join Team page and align the checklist with the server policy. When a user accepts a team invite and sets their password, the same live password policy checklist used on the auth/register page is now displayed, so users no longer have to guess the required length, casing, number, and special-character rules. The checklist's special-character rule previously used a broader pattern than the backend, so a password whose only special character was e.g. `~`, a backtick, or a space could show a green checkmark yet be rejected on submit. The password policy checks (length, casing, number, and the accepted special-character set) now live in a single shared module in `@hyperdx/common-utils` used by both the frontend checklist and the backend `passwordSchema`, so they can no longer drift.
