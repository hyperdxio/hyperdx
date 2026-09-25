---
'@hyperdx/app': patch
---

fix: keep Kubernetes dashboard tables on screen while the page refreshes

On a refresh, the Pods, Nodes and Namespaces tables dropped their rows and
showed a loading skeleton until the new range loaded. They now keep the
current rows on screen and pulse while the refetch runs, like the charts
beside them.
