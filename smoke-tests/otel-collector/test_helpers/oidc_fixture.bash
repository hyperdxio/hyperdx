# Self-contained RSA keypair + OIDC discovery doc + JWKS for the OIDC smoke
# test, plus JWT minting against that keypair. No live OIDC provider is
# available in CI, so the test stack runs its own tiny static file server
# (see docker-compose.yaml's otel-collector-oidc-mock) exposing
# /.well-known/openid-configuration and /.well-known/jwks.json -- the
# collector's OIDC_ISSUER_URL points at it and goes through the exact same
# live-discovery code path a real deployment uses, rather than a
# collector-side config change to bypass discovery.
#
# Deliberate tradeoff: this hand-rolls RSA/JWT/base64url encoding in bash +
# openssl + python3 rather than using an actual JWT library, to avoid adding
# a new dependency to what's otherwise a pure-bash/bats suite. That's a
# judgment call, not an obviously-correct one -- a Go or Node script (this
# repo has both, and the collector itself already depends on go-jose for the
# real verification path) would be less brittle. Every code path here was
# verified against the real compiled binary before this was added (signature
# validated two ways: against the source PEM and independently reconstructed
# from the JWKS n/e fields alone), but "verified to work" isn't the same
# claim as "the most maintainable way to do this." Open to switching if a
# maintainer would rather have that.

_b64url() {
    # Strips newlines unconditionally rather than relying on `base64 -w0`,
    # since GNU and BSD base64 disagree on flags/default wrapping.
    base64 | tr -d '\n' | tr '+/' '-_' | tr -d '='
}

# generate_oidc_fixtures <dir> <issuer_url>
# Writes:
#   <dir>/private.pem                          -- NOT served, signing only
#   <dir>/public/.well-known/openid-configuration
#   <dir>/public/.well-known/jwks.json
# <dir>/public is meant to be served as a static file server's document
# root (see docker-compose.yaml) -- only that subdirectory, so the private
# key is never reachable over HTTP.
generate_oidc_fixtures() {
    local dir="$1" issuer_url="$2"
    mkdir -p "$dir/public/.well-known"
    openssl genrsa -out "$dir/private.pem" 2048 2>/dev/null

    local n_hex
    n_hex=$(openssl rsa -in "$dir/private.pem" -noout -modulus | cut -d= -f2)
    # Strip the ASN.1 INTEGER sign-byte pad ("00") openssl prepends when the
    # modulus's high bit is set, which it usually is for a 2048-bit key.
    n_hex="${n_hex#00}"

    local n_b64
    n_b64=$(python3 -c "
import sys, base64
print(base64.urlsafe_b64encode(bytes.fromhex(sys.argv[1])).decode().rstrip('='))
" "$n_hex")

    cat > "$dir/public/.well-known/jwks.json" <<EOF
{"keys":[{"kty":"RSA","kid":"smoke-test-key","use":"sig","alg":"RS256","n":"$n_b64","e":"AQAB"}]}
EOF

    cat > "$dir/public/.well-known/openid-configuration" <<EOF
{"issuer":"$issuer_url","jwks_uri":"$issuer_url/.well-known/jwks.json","id_token_signing_alg_values_supported":["RS256"]}
EOF
}

# mint_oidc_jwt <dir> <iss> <aud> [exp_offset_seconds]
# Prints a signed RS256 JWT to stdout, using the keypair from
# generate_oidc_fixtures. Default expiry is 1 hour out; pass a negative
# offset to mint an already-expired token.
mint_oidc_jwt() {
    local dir="$1" iss="$2" aud="$3" exp_offset="${4:-3600}"
    local now exp
    now=$(date +%s)
    exp=$((now + exp_offset))

    local header payload signing_input sig
    header=$(printf '{"alg":"RS256","typ":"JWT","kid":"smoke-test-key"}' | _b64url)
    payload=$(printf '{"iss":"%s","aud":"%s","sub":"smoke-test-device","iat":%d,"exp":%d}' \
        "$iss" "$aud" "$now" "$exp" | _b64url)
    signing_input="${header}.${payload}"
    sig=$(printf '%s' "$signing_input" | openssl dgst -sha256 -sign "$dir/private.pem" | _b64url)

    printf '%s.%s' "$signing_input" "$sig"
}
