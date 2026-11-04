import express, { type Request, type Response } from 'express';
import * as oidc from 'openid-client';

import * as config from '@/config';
import { resolveKeycloakUser } from '@/controllers/keycloak';
import { redirectToDashboard } from '@/middleware/auth';
import { getCounter, setBusinessContext } from '@/utils/instrumentation';
import { getKeycloakClient } from '@/utils/keycloak';
import logger from '@/utils/logger';

const authEvents = getCounter('hyperdx.auth.keycloak', {
  description: 'Keycloak authentication outcomes.',
});
const router = express.Router();

function authFailed(_req: Request, res: Response) {
  authEvents.add(1, { outcome: 'failure' });
  // Protocol errors can contain token responses. Never pass them to the logger.
  logger.warn('Keycloak authentication failed');
  res.redirect(303, `${config.FRONTEND_REDIRECT_BASE}/login?err=keycloak`);
}

router.get('/login/keycloak', async (req, res) => {
  if (!config.KEYCLOAK) return res.sendStatus(404);
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  try {
    const client = await getKeycloakClient();
    const transaction = {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier: oidc.randomPKCECodeVerifier(),
      createdAt: Date.now(),
      inviteToken:
        typeof req.query.token === 'string' ? req.query.token : undefined,
    };
    const destination = oidc.buildAuthorizationUrl(client, {
      redirect_uri: config.KEYCLOAK.callbackUrl,
      scope: 'openid email',
      code_challenge: await oidc.calculatePKCECodeChallenge(
        transaction.codeVerifier,
      ),
      code_challenge_method: 'S256',
      state: transaction.state,
      nonce: transaction.nonce,
    });
    req.session.oidc = transaction;
    await new Promise<void>((resolve, reject) =>
      req.session.save(error => (error ? reject(error) : resolve())),
    );
    res.redirect(destination.href);
  } catch {
    authFailed(req, res);
  }
});

router.get('/login/keycloak/callback', async (req, res) => {
  if (!config.KEYCLOAK) return res.sendStatus(404);
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  const transaction = req.session.oidc;
  delete req.session.oidc;
  let loginStarted = false;
  try {
    // Consume even failed callbacks; a fresh login must start a new transaction.
    await new Promise<void>((resolve, reject) =>
      req.session.save(error => (error ? reject(error) : resolve())),
    );
    if (!transaction || Date.now() - transaction.createdAt > 10 * 60 * 1000) {
      return authFailed(req, res);
    }
    const callback = new URL(config.KEYCLOAK.callbackUrl);
    callback.search = new URL(req.originalUrl, config.FRONTEND_URL).search;
    const tokens = await oidc.authorizationCodeGrant(
      await getKeycloakClient(),
      callback,
      {
        pkceCodeVerifier: transaction.codeVerifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims) return authFailed(req, res);
    const user = await resolveKeycloakUser(claims, transaction.inviteToken);
    if (!user) return authFailed(req, res);

    // serializeUser attaches this to Passport's regenerated session. Tokens
    // remain request-local and are never saved.
    req.authInfo = {
      keycloak: {
        issuer: claims.iss,
        subject: claims.sub,
        expiresAt: claims.exp * 1000,
      },
    };
    loginStarted = true;
    await new Promise<void>((resolve, reject) =>
      req.login(user, error => (error ? reject(error) : resolve())),
    );
    setBusinessContext({
      teamId: user.team.toString(),
      userId: user.id,
      email: user.email,
    });
    authEvents.add(1, { outcome: 'success' });
    redirectToDashboard(req, res);
  } catch {
    if (loginStarted) {
      return req.session.destroy(() => authFailed(req, res));
    }
    authFailed(req, res);
  }
});

router.post('/logout', (req, res, next) => {
  // Native same-origin forms send Origin. Fetch Metadata also supports inline
  // previews, where FRONTEND_URL may point at the production deployment.
  const sameOrigin =
    req.get('Sec-Fetch-Site') === 'same-origin' ||
    (config.FRONTEND_URL &&
      req.get('Origin') === new URL(config.FRONTEND_URL).origin);
  if (!sameOrigin) return res.sendStatus(403);
  const wasKeycloak = Boolean(req.session.keycloak);
  req.logout(error => {
    if (error) return next(error);
    req.session.destroy(async error => {
      if (error) return next(error);
      let destination = `${config.FRONTEND_REDIRECT_BASE}/login`;
      if (wasKeycloak && config.KEYCLOAK) {
        try {
          const client = await getKeycloakClient();
          if (client.serverMetadata().end_session_endpoint) {
            destination = oidc.buildEndSessionUrl(client, {
              client_id: config.KEYCLOAK.clientId,
              post_logout_redirect_uri: new URL('/login', config.FRONTEND_URL)
                .href,
            }).href;
          }
        } catch {
          authEvents.add(1, { outcome: 'logout_provider_unavailable' });
          logger.warn('Local logout completed; Keycloak logout unavailable');
        }
      }
      res.redirect(303, destination);
    });
  });
});

export default router;
