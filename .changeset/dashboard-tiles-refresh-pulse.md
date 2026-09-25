---
'@hyperdx/app': patch
---

fix: show that number, bar and pie tiles are refreshing

During a dashboard refresh these tiles kept the previous result on screen with
no sign that new data was loading, so stale values looked current. They now
pulse while the refetch runs, like line and stacked-bar time charts already do.
