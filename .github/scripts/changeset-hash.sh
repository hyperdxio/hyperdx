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

LISTING="$(mktemp)"
trap 'rm -f "$LISTING"' EXIT

# `-z` plus core.quotePath=false gives records with a literal tab before the
# path and no C-quoting, so a changeset whose name contains a space or a
# non-ASCII character stays in one field. Splitting `git ls-tree` on whitespace
# instead would push such a path out of $4 and drop it from the hash, silently
# weakening both the reuse decision and the staleness guard.
#
# The NUL-to-newline conversion has to happen inside the pipeline: a shell
# variable cannot hold NUL bytes (command substitution strips them, which
# collapses every record onto one line).
git -c core.quotePath=false ls-tree -r -z "$REF" -- .changeset \
  | tr '\0' '\n' > "$LISTING"

# `README.md` is excluded by exact path: contributors hand-name changesets, so
# something like `fix-README-links.md` must still count.
hashed() {
  awk -F'\t' '
    NF == 2 && $2 ~ /\.md$/ && $2 != ".changeset/README.md" {
      split($1, meta, " ")
      print meta[3], $2
    }
  ' "$LISTING" | LC_ALL=C sort -k2
}

# The draft and publish jobs must agree on this hash, and macOS (where the test
# also runs) has no sha256sum.
sha256() {
  if command -v sha256sum > /dev/null; then
    sha256sum
  else
    shasum -a 256
  fi
}

# Cross-check the parse by counting the same paths a different way. A dropped
# path is a silent correctness hole in the reuse decision, so fail rather than
# hash a subset.
EXPECTED="$(cut -f2- "$LISTING" \
  | { grep -E '\.md$' || true; } \
  | { grep -vFx '.changeset/README.md' || true; } \
  | { grep -c . || true; })"
ACTUAL="$(hashed | { grep -c . || true; })"

if [ "$ACTUAL" -ne "$EXPECTED" ]; then
  echo "changeset-hash: parsed ${ACTUAL} of ${EXPECTED} changeset paths on ${REF}" >&2
  exit 1
fi

hashed | sha256 | cut -c1-12
