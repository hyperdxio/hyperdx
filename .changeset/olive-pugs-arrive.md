---
'@hyperdx/app': patch
---

Fix search results going blank after expanding and collapsing rows. A row and
its inline expansion are two `tr`s sharing one virtual index, and both were
measured by the virtualizer, so the expanded row took over that index's
ResizeObserver registration and left its height cached there after it
collapsed. Each expand/collapse shrank the render window a little further until
scrolling showed only a handful of rows above empty space. The row and its
expansion are now wrapped in a `tbody` that is measured as one unit.
