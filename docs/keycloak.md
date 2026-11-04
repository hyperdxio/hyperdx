# Keycloak authentication

Keycloak authenticates users; HyperDX retains its users, teams, personal API
keys, and authorization rules. Realm roles and groups do not grant HyperDX
access. Password login remains available until required mode is enabled.

## Configuration

Set these variables on the **API server**, never as `NEXT_PUBLIC_*` variables:

```dotenv
FRONTEND_URL=https://hyperdx.example.com
EXPRESS_SESSION_SECRET=<random secret shared by every API replica>
KEYCLOAK_ISSUER=https://identity.example.com/realms/hyperdx
KEYCLOAK_CLIENT_ID=hyperdx
KEYCLOAK_CLIENT_SECRET=<client secret from Keycloak>
KEYCLOAK_REQUIRED=false
```

The issuer and client ID enable Keycloak. The secret is required for a
confidential client; omit it only for a public client. Partial configuration
fails startup. HTTPS is required in production; outside production, HTTP is
allowed only on loopback hosts. Local/no-auth app mode cannot enable Keycloak.

The root Docker Compose file forwards the four Keycloak variables from `.env`.
Set `FRONTEND_URL` to the browser-facing origin in your Compose override when
using an HTTPS reverse proxy. For `yarn dev`, use the API environment above
(examples are in `packages/api/.env.development`). No frontend secret or
frontend environment flag is needed.

Create an OpenID Connect client in Keycloak:

- Enable **Standard flow** (Authorization Code). Enable client authentication
  for a confidential client. Disable implicit flow and direct access grants.
- Require PKCE **S256**. Make the `email` scope available and include `email`
  and `email_verified` in ID tokens. Require email verification for invitees.
- Set the exact valid redirect URI to
  `https://hyperdx.example.com/api/login/keycloak/callback`.
- Set the exact valid post-logout redirect URI to
  `https://hyperdx.example.com/login`. Avoid wildcards.

Endpoints come from OIDC discovery. The callback is derived from `FRONTEND_URL`
and uses the existing frontend `/api` proxy. Keep the API private behind the
trusted proxy: Express currently trusts one proxy hop. Preserve HTTPS forwarding
headers so the existing Secure, HttpOnly, SameSite=Lax session cookie works.
All replicas need the same MongoDB, session secret, and Keycloak settings.

## Provisioning and migration

1. Bootstrap an empty installation with the existing password registration flow
   **before** enabling required mode. Keycloak login never creates a team.
2. Explicitly map existing users as below. An email match never links accounts.
3. Invite new users through HyperDX's existing team invitation UI. The invitee
   opens that link and chooses **Sign in with Keycloak**. Their verified email
   must match the invitation; the invitation must be less than 30 days old.
   Only that invited team is assigned. Existing accounts must be mapped instead.
4. Verify login, access, and logout, then set `KEYCLOAK_REQUIRED=true` on every
   API replica. Password login, registration, and password invitation acceptance
   return 403. Existing password sessions stop working on protected routes.

For an existing user, an operator with database access must verify the intended
person's exact OIDC issuer and subject independently. Do not infer them from an
email or username. After starting this version (which creates the partial unique
identity index), use `mongosh` against the intended HyperDX database:

```javascript
db.users.updateOne(
  {
    _id: ObjectId('<verified HyperDX user ID>'),
    team: ObjectId('<verified existing HyperDX team ID>'),
    keycloak: { $exists: false },
  },
  { $set: { keycloak: {
    issuer: 'https://identity.example.com/realms/hyperdx',
    subject: '<verified OIDC sub>',
  } } },
);
```

Require `modifiedCount: 1`. A zero match or duplicate-key error requires
investigation; do not remove the filter or overwrite an existing identity.
The compound unique index prevents one identity from belonging to two users.
Mapping preserves the user's team, password, and API key. Changing email at
Keycloak does not change the identity mapping or HyperDX's stored email.

## Sessions and logout

Login validates state, nonce, PKCE, issuer, audience, signature, and expiry using
[`openid-client`](https://github.com/panva/openid-client). Passport rotates the
session ID. Only issuer, subject, and expiry are stored alongside the existing
Passport user ID; no access, refresh, or ID tokens are persisted.

Keycloak sessions have an absolute deadline at ID token expiry, capped by
HyperDX's existing 30-day session limit. Activity cannot extend that deadline;
after it, the user must sign in again (Keycloak may still have an SSO session).
Password sessions retain their existing rolling 30-day behavior.

The logout menu submits a same-origin POST, destroys the local session, then
uses the discovered end-session endpoint. Keycloak may ask for confirmation
because no ID token hint is retained. See
[Keycloak logout](https://www.keycloak.org/securing-apps/oidc-layers#_logout).

**Back-channel logout and token refresh are not implemented.** Logging out at
Keycloak, disabling a realm account, or changing realm roles does not immediately
invalidate an existing HyperDX session. It remains usable until its deadline.
Deleting the HyperDX user or removing its mapping revokes browser access on the
next protected request. Personal API keys retain existing behavior and must be
revoked separately; required mode governs interactive login.

Keep auth query strings, request bodies, and redirect headers out of reverse
proxy/APM logs. Application request logs redact the new auth URLs and never log
protocol error objects. To roll back, disable required mode first; removing all
Keycloak variables also disables its routes and invalidates its browser sessions.
