// Static imports so tsc copies the JSON into dist; regenerate when incidents are re-synced.
import g0 from './generator/incidents/api-version-brownout/ground-truth.json';
import g1 from './generator/incidents/bad-node/ground-truth.json';
import g2 from './generator/incidents/breaker-stuck-open/ground-truth.json';
import g3 from './generator/incidents/broker-disk-alarm/ground-truth.json';
import g4 from './generator/incidents/bulk-import/ground-truth.json';
import g5 from './generator/incidents/burst-balance/ground-truth.json';
import g6 from './generator/incidents/cache-stampede/ground-truth.json';
import g7 from './generator/incidents/cart-badge-polling/ground-truth.json';
import g8 from './generator/incidents/cart-retention/ground-truth.json';
import g9 from './generator/incidents/cdn-cache-bypass/ground-truth.json';
import g10 from './generator/incidents/client-release/ground-truth.json';
import g11 from './generator/incidents/client-timeout/ground-truth.json';
import g12 from './generator/incidents/clock-skew/ground-truth.json';
import g13 from './generator/incidents/connection-limit/ground-truth.json';
import g14 from './generator/incidents/cookie-header-overflow/ground-truth.json';
import g15 from './generator/incidents/cpu-throttle/ground-truth.json';
import g16 from './generator/incidents/date-rollover/ground-truth.json';
import g17 from './generator/incidents/db-switchover/ground-truth.json';
import g18 from './generator/incidents/debug-logging/ground-truth.json';
import g19 from './generator/incidents/denylist-oom/ground-truth.json';
import g20 from './generator/incidents/dependency-cascade/ground-truth.json';
import g21 from './generator/incidents/deploy-red-herring/ground-truth.json';
import g22 from './generator/incidents/deploy-regression/ground-truth.json';
import g23 from './generator/incidents/discount-typo/ground-truth.json';
import g24 from './generator/incidents/disk-full/ground-truth.json';
import g25 from './generator/incidents/dns-timeouts/ground-truth.json';
import g26 from './generator/incidents/egress-policy/ground-truth.json';
import g27 from './generator/incidents/entitlement-lapse/ground-truth.json';
import g28 from './generator/incidents/erp-order-sync/ground-truth.json';
import g29 from './generator/incidents/es-cert-expiry/ground-truth.json';
import g30 from './generator/incidents/event-loop-block/ground-truth.json';
import g31 from './generator/incidents/fd-leak/ground-truth.json';
import g32 from './generator/incidents/flag-flip/ground-truth.json';
import g33 from './generator/incidents/flag-sdk-defaults/ground-truth.json';
import g34 from './generator/incidents/fraud-rule-publish/ground-truth.json';
import g35 from './generator/incidents/fx-rates-stale/ground-truth.json';
import g36 from './generator/incidents/gateway-route-timeout/ground-truth.json';
import g37 from './generator/incidents/geocode-latency/ground-truth.json';
import g38 from './generator/incidents/geoip-refresh/ground-truth.json';
import g39 from './generator/incidents/hot-key/ground-truth.json';
import g40 from './generator/incidents/id-sequence-exhausted/ground-truth.json';
import g41 from './generator/incidents/idle-socket-reset/ground-truth.json';
import g42 from './generator/incidents/idp-key-rotation/ground-truth.json';
import g43 from './generator/incidents/inventory-query-regression/ground-truth.json';
import g44 from './generator/incidents/kms-quota/ground-truth.json';
import g45 from './generator/incidents/log-shipper-backpressure/ground-truth.json';
import g46 from './generator/incidents/malformed-response/ground-truth.json';
import g47 from './generator/incidents/memory-leak/ground-truth.json';
import g48 from './generator/incidents/mesh-root-rotation/ground-truth.json';
import g49 from './generator/incidents/migration-lock/ground-truth.json';
import g50 from './generator/incidents/mtu-mismatch/ground-truth.json';
import g51 from './generator/incidents/nat-allowlist/ground-truth.json';
import g52 from './generator/incidents/node-drain/ground-truth.json';
import g53 from './generator/incidents/noisy-neighbour/ground-truth.json';
import g54 from './generator/incidents/outlier-ejection/ground-truth.json';
import g55 from './generator/incidents/pim-weight-units/ground-truth.json';
import g56 from './generator/incidents/pool-exhaustion/ground-truth.json';
import g57 from './generator/incidents/queue-backpressure/ground-truth.json';
import g58 from './generator/incidents/rate-limit/ground-truth.json';
import g59 from './generator/incidents/reco-model-swap/ground-truth.json';
import g60 from './generator/incidents/redis-reshard/ground-truth.json';
import g61 from './generator/incidents/replica-lag/ground-truth.json';
import g62 from './generator/incidents/retry-storm/ground-truth.json';
import g63 from './generator/incidents/sca-enforcement/ground-truth.json';
import g64 from './generator/incidents/segment-regression/ground-truth.json';
import g65 from './generator/incidents/session-purge/ground-truth.json';
import g66 from './generator/incidents/session-schema/ground-truth.json';
import g67 from './generator/incidents/sessions-maxmemory/ground-truth.json';
import g68 from './generator/incidents/sms-provider-slow/ground-truth.json';
import g69 from './generator/incidents/stale-credential/ground-truth.json';
import g70 from './generator/incidents/stats-after-upgrade/ground-truth.json';
import g71 from './generator/incidents/stock-reconciliation/ground-truth.json';
import g72 from './generator/incidents/subnet-exhaustion/ground-truth.json';
import g73 from './generator/incidents/synonym-set/ground-truth.json';
import g74 from './generator/incidents/tax-provider-errors/ground-truth.json';
import g75 from './generator/incidents/traffic-surge/ground-truth.json';
import g76 from './generator/incidents/two-faults/ground-truth.json';
import g77 from './generator/incidents/vault-sealed/ground-truth.json';
import g78 from './generator/incidents/vendor-reason-code/ground-truth.json';
import g79 from './generator/incidents/waf-ruleset/ground-truth.json';
import type { SmokehouseGroundTruth } from './scenario';

export const GROUND_TRUTH: Record<string, SmokehouseGroundTruth> = {
  'api-version-brownout': g0 as unknown as SmokehouseGroundTruth,
  'bad-node': g1 as unknown as SmokehouseGroundTruth,
  'breaker-stuck-open': g2 as unknown as SmokehouseGroundTruth,
  'broker-disk-alarm': g3 as unknown as SmokehouseGroundTruth,
  'bulk-import': g4 as unknown as SmokehouseGroundTruth,
  'burst-balance': g5 as unknown as SmokehouseGroundTruth,
  'cache-stampede': g6 as unknown as SmokehouseGroundTruth,
  'cart-badge-polling': g7 as unknown as SmokehouseGroundTruth,
  'cart-retention': g8 as unknown as SmokehouseGroundTruth,
  'cdn-cache-bypass': g9 as unknown as SmokehouseGroundTruth,
  'client-release': g10 as unknown as SmokehouseGroundTruth,
  'client-timeout': g11 as unknown as SmokehouseGroundTruth,
  'clock-skew': g12 as unknown as SmokehouseGroundTruth,
  'connection-limit': g13 as unknown as SmokehouseGroundTruth,
  'cookie-header-overflow': g14 as unknown as SmokehouseGroundTruth,
  'cpu-throttle': g15 as unknown as SmokehouseGroundTruth,
  'date-rollover': g16 as unknown as SmokehouseGroundTruth,
  'db-switchover': g17 as unknown as SmokehouseGroundTruth,
  'debug-logging': g18 as unknown as SmokehouseGroundTruth,
  'denylist-oom': g19 as unknown as SmokehouseGroundTruth,
  'dependency-cascade': g20 as unknown as SmokehouseGroundTruth,
  'deploy-red-herring': g21 as unknown as SmokehouseGroundTruth,
  'deploy-regression': g22 as unknown as SmokehouseGroundTruth,
  'discount-typo': g23 as unknown as SmokehouseGroundTruth,
  'disk-full': g24 as unknown as SmokehouseGroundTruth,
  'dns-timeouts': g25 as unknown as SmokehouseGroundTruth,
  'egress-policy': g26 as unknown as SmokehouseGroundTruth,
  'entitlement-lapse': g27 as unknown as SmokehouseGroundTruth,
  'erp-order-sync': g28 as unknown as SmokehouseGroundTruth,
  'es-cert-expiry': g29 as unknown as SmokehouseGroundTruth,
  'event-loop-block': g30 as unknown as SmokehouseGroundTruth,
  'fd-leak': g31 as unknown as SmokehouseGroundTruth,
  'flag-flip': g32 as unknown as SmokehouseGroundTruth,
  'flag-sdk-defaults': g33 as unknown as SmokehouseGroundTruth,
  'fraud-rule-publish': g34 as unknown as SmokehouseGroundTruth,
  'fx-rates-stale': g35 as unknown as SmokehouseGroundTruth,
  'gateway-route-timeout': g36 as unknown as SmokehouseGroundTruth,
  'geocode-latency': g37 as unknown as SmokehouseGroundTruth,
  'geoip-refresh': g38 as unknown as SmokehouseGroundTruth,
  'hot-key': g39 as unknown as SmokehouseGroundTruth,
  'id-sequence-exhausted': g40 as unknown as SmokehouseGroundTruth,
  'idle-socket-reset': g41 as unknown as SmokehouseGroundTruth,
  'idp-key-rotation': g42 as unknown as SmokehouseGroundTruth,
  'inventory-query-regression': g43 as unknown as SmokehouseGroundTruth,
  'kms-quota': g44 as unknown as SmokehouseGroundTruth,
  'log-shipper-backpressure': g45 as unknown as SmokehouseGroundTruth,
  'malformed-response': g46 as unknown as SmokehouseGroundTruth,
  'memory-leak': g47 as unknown as SmokehouseGroundTruth,
  'mesh-root-rotation': g48 as unknown as SmokehouseGroundTruth,
  'migration-lock': g49 as unknown as SmokehouseGroundTruth,
  'mtu-mismatch': g50 as unknown as SmokehouseGroundTruth,
  'nat-allowlist': g51 as unknown as SmokehouseGroundTruth,
  'node-drain': g52 as unknown as SmokehouseGroundTruth,
  'noisy-neighbour': g53 as unknown as SmokehouseGroundTruth,
  'outlier-ejection': g54 as unknown as SmokehouseGroundTruth,
  'pim-weight-units': g55 as unknown as SmokehouseGroundTruth,
  'pool-exhaustion': g56 as unknown as SmokehouseGroundTruth,
  'queue-backpressure': g57 as unknown as SmokehouseGroundTruth,
  'rate-limit': g58 as unknown as SmokehouseGroundTruth,
  'reco-model-swap': g59 as unknown as SmokehouseGroundTruth,
  'redis-reshard': g60 as unknown as SmokehouseGroundTruth,
  'replica-lag': g61 as unknown as SmokehouseGroundTruth,
  'retry-storm': g62 as unknown as SmokehouseGroundTruth,
  'sca-enforcement': g63 as unknown as SmokehouseGroundTruth,
  'segment-regression': g64 as unknown as SmokehouseGroundTruth,
  'session-purge': g65 as unknown as SmokehouseGroundTruth,
  'session-schema': g66 as unknown as SmokehouseGroundTruth,
  'sessions-maxmemory': g67 as unknown as SmokehouseGroundTruth,
  'sms-provider-slow': g68 as unknown as SmokehouseGroundTruth,
  'stale-credential': g69 as unknown as SmokehouseGroundTruth,
  'stats-after-upgrade': g70 as unknown as SmokehouseGroundTruth,
  'stock-reconciliation': g71 as unknown as SmokehouseGroundTruth,
  'subnet-exhaustion': g72 as unknown as SmokehouseGroundTruth,
  'synonym-set': g73 as unknown as SmokehouseGroundTruth,
  'tax-provider-errors': g74 as unknown as SmokehouseGroundTruth,
  'traffic-surge': g75 as unknown as SmokehouseGroundTruth,
  'two-faults': g76 as unknown as SmokehouseGroundTruth,
  'vault-sealed': g77 as unknown as SmokehouseGroundTruth,
  'vendor-reason-code': g78 as unknown as SmokehouseGroundTruth,
  'waf-ruleset': g79 as unknown as SmokehouseGroundTruth,
};
