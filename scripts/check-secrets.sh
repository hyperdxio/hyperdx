#!/usr/bin/env bash
# Pre-commit secret scanner.
#
# Blocks commits that introduce values matching well-known sensitive
# patterns: AWS account IDs adjacent to AWS resource references,
# AKIA-prefixed access key IDs, and AWS secret access key environment
# assignments.
#
# Bypass on a single line: append `# allow-secret-scan`.  Use sparingly
# and only for legitimate placeholders or doc examples that genuinely
# need a 12-digit number / AKIA-shaped string.

set -eu

files=$(git diff --cached --name-only --diff-filter=ACMR)
[ -z "$files" ] && exit 0

violations=0

# Patterns. Each is a single ERE — kept tight to minimise false positives.
PAT_AWS_RESOURCE='(arn:aws:[^"'\''[:space:]]*:[0-9]{12}:|[0-9]{12}:s3tablescatalog/|aws-athena-query-results-[0-9]{12})'
PAT_AKIA='AKIA[0-9A-Z]{16}'
PAT_SECRET_KEY='(aws_secret_access_key|AWS_SECRET_ACCESS_KEY)[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9/+=]{20,}'

scan_file() {
  local f="$1" content matches

  # Skip binaries and lockfiles by extension.
  case "$f" in
    *.lock|*.png|*.jpg|*.jpeg|*.gif|*.pdf|*.zip|*.tgz|*.gz|*.ico|*.woff|*.woff2|*.ttf|*.otf|*.eot)
      return 0
      ;;
  esac

  # Skip the scanner script itself — it intentionally contains the
  # patterns it scans for.
  case "$f" in
    scripts/check-secrets.sh) return 0 ;;
  esac

  content=$(git show ":$f" 2>/dev/null) || return 0
  # Drop bypass-tagged lines from scan input.
  content=$(printf '%s\n' "$content" | grep -v 'allow-secret-scan' || true)
  [ -z "$content" ] && return 0

  scan() {
    local label="$1" pattern="$2"
    if matches=$(printf '%s\n' "$content" | grep -nE "$pattern"); then
      printf '  [%s] %s\n' "$f" "$label" >&2
      printf '%s\n' "$matches" | sed 's/^/    /' >&2
      violations=$((violations + 1))
    fi
  }

  scan 'AWS account ID near AWS resource'   "$PAT_AWS_RESOURCE"
  scan 'AWS access key ID (AKIA...)'        "$PAT_AKIA"
  scan 'AWS secret access key assignment'   "$PAT_SECRET_KEY"
}

while IFS= read -r f; do
  [ -n "$f" ] && scan_file "$f"
done <<EOF
$files
EOF

if [ "$violations" -gt 0 ]; then
  printf '\n[secret-scan] %d match(es) above. Fix the values or append\n' "$violations" >&2
  printf "  '# allow-secret-scan' to the line if it is a legitimate\n" >&2
  printf '  placeholder / doc example.\n' >&2
  exit 1
fi

exit 0
