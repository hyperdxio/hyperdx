import { emitLog } from '../../emit';
import { crossed } from '../../tick';
import type { Incident } from '../index';

const OLD = '1.4.2';
const WORKLOADS = ['search', 'web-bff', 'mobile-bff', 'checkout', 'pricing'];
const ROTATE_STEP_MS = 60_000,
  XDS_LEAD_MS = 2 * 60_000,
  GATEWAY_CERT_LEAD_MS = 5 * 60_000,
  HANDSHAKE_EVERY_MS = 15_000;
// The callee each caller has just heard back from when it dials pricing, by route.
const BEFORE_PRICING: Record<string, Record<string, string>> = {
  search: { 'GET /search': 'catalog' },
  'web-bff': { 'GET /product/{id}': 'catalog', 'GET /cart': 'cart' },
  'mobile-bff': { 'GET /product/{id}': 'catalog', 'GET /cart': 'cart' },
  checkout: { 'POST /checkout': 'cart' },
};
// Workload certificates renew on their own schedule, so each pod picks up the new root at a scattered time.
const rotatedAt = (svc: string, i: number, onset: Date) =>
  onset.getTime() +
  (((WORKLOADS.indexOf(svc) * 6 + i - 1) * 7) % 30) * ROTATE_STEP_MS;
const rotated = (t: Date, onset: Date) =>
  new Set(
    WORKLOADS.flatMap(s =>
      [1, 2, 3, 4, 5, 6]
        .filter(i => t.getTime() >= rotatedAt(s, i, onset))
        .map(i => `${s}-${i}`),
    ),
  );

// The mesh's root CA moves to istio-ca-root-2026 and every sidecar is meant to trust both roots. pricing's
// sidecars run a pinned older proxy that rejects the updated trust bundle, so they refuse callers whose
// certificates now chain to the new root. Rejected calls never reach the pricing app.
export const meshRootRotation: Incident = {
  name: 'mesh-root-rotation',
  defaultOnsetMs: -18 * 60_000,
  apply(t, onset, world) {
    const on = rotated(t, onset);
    if (on.size === 0) return world;
    for (const [svc, routes] of Object.entries(BEFORE_PRICING)) {
      world[svc].afterCall = (ctx, callee) =>
        !on.has(ctx.pod) || routes[ctx.route] !== callee.service
          ? null
          : {
              status: 503,
              message:
                'upstream connect error or disconnect/reset before headers. reset reason: connection failure, transport failure reason: TLS_error:|268435581:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED (pricing.commerce.svc.cluster.local:8080)',
              durationMs: ctx.rng.gauss(6, 2),
              log: {
                severity: 'ERROR',
                every: 4,
                body: 'PricingClientError: 503 calling pricing.quote: upstream connect error or disconnect/reset before headers. reset reason: connection failure, transport failure reason: TLS_error:|268435581:SSL routines:OPENSSL_internal:CERTIFICATE_VERIFY_FAILED\n    at PricingClient.quote (/app/lib/pricing-client.js:64:13)',
              },
            };
    }
    return world;
  },
  events(t, onset, stepMs) {
    const at = onset.getTime();
    for (let i = 1; i <= 6; i++) {
      for (const svc of WORKLOADS) {
        const when = rotatedAt(svc, i, onset);
        if (crossed(t, stepMs, when))
          emitLog(
            svc,
            `${svc}-${i}`,
            OLD,
            when,
            'INFO',
            `sds: workload certificate spiffe://cluster.local/ns/commerce/sa/${svc} rotated on ${svc}-${i}, issued by istio-ca-root-2026 (previously istio-ca-root-2023), valid 24h`,
            { 'event.name': 'istio.sds.rotation' },
          );
      }
      const xds = at - XDS_LEAD_MS + i * 3_000;
      if (crossed(t, stepMs, xds))
        emitLog(
          'pricing',
          `pricing-${i}`,
          OLD,
          xds,
          'WARN',
          `xds: gRPC config for type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.Secret ROOTCA rejected on pricing-${i} (istio-proxy 1.18.7): unknown field "custom_validator_config"`,
          { 'event.name': 'istio.xds.rejected' },
        );
      const cert = at - GATEWAY_CERT_LEAD_MS + i * 2_000;
      if (crossed(t, stepMs, cert))
        emitLog(
          'edge-gateway',
          `edge-gateway-${i}`,
          OLD,
          cert,
          'INFO',
          `cert-manager: certificate shop-example-com-tls renewed by letsencrypt-prod (not after 2026-12-21), listener reloaded on edge-gateway-${i}`,
          { 'event.name': 'cert-manager.renewal' },
        );
    }
    const callers = [...rotated(t, onset)].filter(
      p => !p.startsWith('pricing-'),
    ).length;
    const when =
      Math.floor(t.getTime() / HANDSHAKE_EVERY_MS) * HANDSHAKE_EVERY_MS;
    if (callers === 0 || !crossed(t, stepMs, when)) return;
    const n = when / HANDSHAKE_EVERY_MS,
      pod = `pricing-${1 + (n % 6)}`;
    emitLog(
      'pricing',
      pod,
      OLD,
      when,
      'WARN',
      `istio-proxy on ${pod}: ${callers * (2 + (n % 5))} inbound TLS handshakes failed in the last 15s: x509: certificate signed by unknown authority`,
      { 'event.name': 'istio.tls.handshake_failed' },
    );
  },
};
