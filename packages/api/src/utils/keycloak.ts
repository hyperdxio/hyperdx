import * as oidc from 'openid-client';

import { IS_PROD, KEYCLOAK } from '@/config';

let client: Promise<oidc.Configuration> | undefined;

export function getKeycloakClient() {
  if (!KEYCLOAK) throw new Error('Keycloak is not configured');
  if (!client) {
    client = oidc
      .discovery(
        new URL(KEYCLOAK.issuer),
        KEYCLOAK.clientId,
        KEYCLOAK.clientSecret,
        KEYCLOAK.clientSecret
          ? oidc.ClientSecretPost(KEYCLOAK.clientSecret)
          : oidc.None(),
        {
          timeout: 10,
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(!IS_PROD && KEYCLOAK.issuer.startsWith('http:')
              ? [oidc.allowInsecureRequests]
              : []),
          ],
        },
      )
      .catch(error => {
        client = undefined;
        throw error;
      });
  }
  return client;
}
