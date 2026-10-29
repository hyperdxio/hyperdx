---
'@hyperdx/common-utils': minor
'@hyperdx/api': minor
'@hyperdx/app': minor
---

feat: Expose alert tags to Generic and incident.io webhook bodies as `{{tags}}` (comma-separated, or iterate with `{{#each tags}}`), and include them in the default incident.io body's `metadata.tags`, so one shared webhook can route alerts by owning team
