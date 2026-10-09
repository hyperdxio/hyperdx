---
'@hyperdx/common-utils': patch
'@hyperdx/app': patch
---

fix: the webhook form now compiles the body template as you edit it and shows
the Handlebars error with its line and column. A broken template used to give
no feedback until an alert failed to deliver.
