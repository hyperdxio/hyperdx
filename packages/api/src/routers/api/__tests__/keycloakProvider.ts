import express from 'express';
import { createServer } from 'http';
import Provider from 'oidc-provider';
import request from 'supertest';

export async function startKeycloakTestProvider() {
  const app = express();
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test port');
  const issuer = `http://127.0.0.1:${address.port}`;
  const account = {
    sub: 'test-subject',
    email: 'member@example.com',
    email_verified: true,
  };
  const settings = { idTokenTtl: 300 };
  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: 'hyperdx',
        client_secret: 'test-only-secret',
        redirect_uris: ['http://127.0.0.1:4500/api/login/keycloak/callback'],
        post_logout_redirect_uris: ['http://127.0.0.1:4500/login'],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'client_secret_post',
      },
    ],
    features: { devInteractions: { enabled: false } },
    claims: { openid: ['sub'], email: ['email', 'email_verified'] },
    conformIdTokenClaims: false,
    ttl: {
      IdToken: () => settings.idTokenTtl,
      AccessToken: 300,
      Interaction: 300,
      Session: 300,
      Grant: 300,
    },
    pkce: { required: () => true },
    findAccount: async () => ({
      accountId: account.sub,
      claims: async () => ({ ...account }),
    }),
  });
  app.get('/interaction/:uid', async (req, res, next) => {
    try {
      await provider.interactionDetails(req, res);
      const grant = new provider.Grant({
        accountId: account.sub,
        clientId: 'hyperdx',
      });
      grant.addOIDCScope('openid email');
      await provider.interactionFinished(
        req,
        res,
        {
          login: { accountId: account.sub },
          consent: { grantId: await grant.save() },
        },
        { mergeWithLastSubmission: false },
      );
    } catch (error) {
      next(error);
    }
  });
  app.use(provider.callback());

  return {
    issuer,
    account,
    settings,
    async authorize(url: string) {
      const agent = request.agent(server);
      let destination = new URL(url);
      for (let i = 0; i < 6 && destination.origin === issuer; i++) {
        const response = await agent.get(
          destination.pathname + destination.search,
        );
        if (![302, 303].includes(response.status))
          throw new Error(
            `OIDC provider returned ${response.status}: ${response.text}`,
          );
        destination = new URL(response.headers.location, issuer);
      }
      if (destination.origin === issuer)
        throw new Error('OIDC interaction did not finish');
      return destination.pathname.replace(/^\/api/, '') + destination.search;
    },
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      ),
  };
}
