#!/usr/bin/env bash
# Content-address the set of changesets on a ref (default origin/main).
#
# The release-changelog jobs reuse a previously published section when this
# hash is unchanged, and the publish job re-derives it to detect that the
# release branch moved while the model was drafting. Both call this script:
# if the two computations ever drifted, the staleness guard would silently
# stop guarding. Hashes blob SHAs, so an edit to a changeset counts as a
# change, not just an add or remove.
set -euo pipefail

REF="${1:-origin/main}"

# `$4 != ".changeset/README.md"` is anchored to the exact path: contributors
# hand-name changesets, so a file like `fix-README-links.md` must still count.
git ls-tree -r "$REF" -- .changeset \
  | awk '$4 ~ /\.md$/ && $4 != ".changeset/README.md" {print $3, $4}' \
  | sort -k2 \
  | sha256sum \
  | cut -c1-12
