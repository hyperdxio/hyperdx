import type { Forced } from '../walker';
import type { World } from '../world';

// Two hooks because rollout logs have no request to hang off: apply shapes every request at
// time t, events emits the records a tick owns on its own.
export type Incident = {
  name: string;
  defaultOnsetMs: number;
  apply: (t: Date, onset: Date, world: World) => World;
  events?: (t: Date, onset: Date, stepMs: number) => void;
  // Requests added on top of each tick's one, for incidents where volume is the cause.
  surge?: (t: Date, onset: Date) => { forced: Forced; perTick: number } | null;
};

import { apiVersionBrownout } from './api-version-brownout/incident';
import { badNode } from './bad-node/incident';
import { breakerStuckOpen } from './breaker-stuck-open/incident';
import { brokerDiskAlarm } from './broker-disk-alarm/incident';
import { bulkImport } from './bulk-import/incident';
import { burstBalance } from './burst-balance/incident';
import { cacheStampede } from './cache-stampede/incident';
import { cartBadgePolling } from './cart-badge-polling/incident';
import { cartRetention } from './cart-retention/incident';
import { cdnCacheBypass } from './cdn-cache-bypass/incident';
import { clientRelease } from './client-release/incident';
import { clientTimeout } from './client-timeout/incident';
import { clockSkew } from './clock-skew/incident';
import { connectionLimit } from './connection-limit/incident';
import { cookieHeaderOverflow } from './cookie-header-overflow/incident';
import { cpuThrottle } from './cpu-throttle/incident';
import { dateRollover } from './date-rollover/incident';
import { dbSwitchover } from './db-switchover/incident';
import { debugLogging } from './debug-logging/incident';
import { denylistOom } from './denylist-oom/incident';
import { dependencyCascade } from './dependency-cascade/incident';
import { deployRedHerring } from './deploy-red-herring/incident';
import { deployRegression } from './deploy-regression/incident';
import { discountTypo } from './discount-typo/incident';
import { diskFull } from './disk-full/incident';
import { dnsTimeouts } from './dns-timeouts/incident';
import { egressPolicy } from './egress-policy/incident';
import { entitlementLapse } from './entitlement-lapse/incident';
import { erpOrderSync } from './erp-order-sync/incident';
import { esCertExpiry } from './es-cert-expiry/incident';
import { eventLoopBlock } from './event-loop-block/incident';
import { fdLeak } from './fd-leak/incident';
import { flagFlip } from './flag-flip/incident';
import { flagSdkDefaults } from './flag-sdk-defaults/incident';
import { fraudRulePublish } from './fraud-rule-publish/incident';
import { fxRatesStale } from './fx-rates-stale/incident';
import { gatewayRouteTimeout } from './gateway-route-timeout/incident';
import { geocodeLatency } from './geocode-latency/incident';
import { geoipRefresh } from './geoip-refresh/incident';
import { hotKey } from './hot-key/incident';
import { idSequenceExhausted } from './id-sequence-exhausted/incident';
import { idleSocketReset } from './idle-socket-reset/incident';
import { idpKeyRotation } from './idp-key-rotation/incident';
import { inventoryQueryRegression } from './inventory-query-regression/incident';
import { kmsQuota } from './kms-quota/incident';
import { logShipperBackpressure } from './log-shipper-backpressure/incident';
import { malformedResponse } from './malformed-response/incident';
import { memoryLeak } from './memory-leak/incident';
import { meshRootRotation } from './mesh-root-rotation/incident';
import { migrationLock } from './migration-lock/incident';
import { mtuMismatch } from './mtu-mismatch/incident';
import { natAllowlist } from './nat-allowlist/incident';
import { nodeDrain } from './node-drain/incident';
import { noisyNeighbour } from './noisy-neighbour/incident';
import { outlierEjection } from './outlier-ejection/incident';
import { pimWeightUnits } from './pim-weight-units/incident';
import { poolExhaustion } from './pool-exhaustion/incident';
import { queueBackpressure } from './queue-backpressure/incident';
import { rateLimit } from './rate-limit/incident';
import { recoModelSwap } from './reco-model-swap/incident';
import { redisReshard } from './redis-reshard/incident';
import { replicaLag } from './replica-lag/incident';
import { retryStorm } from './retry-storm/incident';
import { scaEnforcement } from './sca-enforcement/incident';
import { segmentRegression } from './segment-regression/incident';
import { sessionPurge } from './session-purge/incident';
import { sessionSchema } from './session-schema/incident';
import { sessionsMaxmemory } from './sessions-maxmemory/incident';
import { smsProviderSlow } from './sms-provider-slow/incident';
import { staleCredential } from './stale-credential/incident';
import { statsAfterUpgrade } from './stats-after-upgrade/incident';
import { stockReconciliation } from './stock-reconciliation/incident';
import { subnetExhaustion } from './subnet-exhaustion/incident';
import { synonymSet } from './synonym-set/incident';
import { taxProviderErrors } from './tax-provider-errors/incident';
import { trafficSurge } from './traffic-surge/incident';
import { twoFaults } from './two-faults/incident';
import { vaultSealed } from './vault-sealed/incident';
import { vendorReasonCode } from './vendor-reason-code/incident';
import { wafRuleset } from './waf-ruleset/incident';
export const INCIDENTS: Record<string, Incident> = {
  [deployRegression.name]: deployRegression,
  [dependencyCascade.name]: dependencyCascade,
  [segmentRegression.name]: segmentRegression,
  [deployRedHerring.name]: deployRedHerring,
  [twoFaults.name]: twoFaults,
  [poolExhaustion.name]: poolExhaustion,
  [trafficSurge.name]: trafficSurge,
  [flagFlip.name]: flagFlip,
  [badNode.name]: badNode,
  [retryStorm.name]: retryStorm,
  [esCertExpiry.name]: esCertExpiry,
  [memoryLeak.name]: memoryLeak,
  [migrationLock.name]: migrationLock,
  [rateLimit.name]: rateLimit,
  [diskFull.name]: diskFull,
  [malformedResponse.name]: malformedResponse,
  [eventLoopBlock.name]: eventLoopBlock,
  [dateRollover.name]: dateRollover,
  [clientRelease.name]: clientRelease,
  [breakerStuckOpen.name]: breakerStuckOpen,
  [staleCredential.name]: staleCredential,
  [clientTimeout.name]: clientTimeout,
  [dbSwitchover.name]: dbSwitchover,
  [entitlementLapse.name]: entitlementLapse,
  [connectionLimit.name]: connectionLimit,
  [hotKey.name]: hotKey,
  [cacheStampede.name]: cacheStampede,
  [fdLeak.name]: fdLeak,
  [clockSkew.name]: clockSkew,
  [sessionSchema.name]: sessionSchema,
  [queueBackpressure.name]: queueBackpressure,
  [geocodeLatency.name]: geocodeLatency,
  [idleSocketReset.name]: idleSocketReset,
  [cpuThrottle.name]: cpuThrottle,
  [bulkImport.name]: bulkImport,
  [smsProviderSlow.name]: smsProviderSlow,
  [statsAfterUpgrade.name]: statsAfterUpgrade,
  [mtuMismatch.name]: mtuMismatch,
  [taxProviderErrors.name]: taxProviderErrors,
  [egressPolicy.name]: egressPolicy,
  [idSequenceExhausted.name]: idSequenceExhausted,
  [wafRuleset.name]: wafRuleset,
  [apiVersionBrownout.name]: apiVersionBrownout,
  [recoModelSwap.name]: recoModelSwap,
  [nodeDrain.name]: nodeDrain,
  [debugLogging.name]: debugLogging,
  [replicaLag.name]: replicaLag,
  [vendorReasonCode.name]: vendorReasonCode,
  [stockReconciliation.name]: stockReconciliation,
  [meshRootRotation.name]: meshRootRotation,
  [cookieHeaderOverflow.name]: cookieHeaderOverflow,
  [synonymSet.name]: synonymSet,
  [dnsTimeouts.name]: dnsTimeouts,
  [burstBalance.name]: burstBalance,
  [idpKeyRotation.name]: idpKeyRotation,
  [logShipperBackpressure.name]: logShipperBackpressure,
  [denylistOom.name]: denylistOom,
  [sessionPurge.name]: sessionPurge,
  [cartRetention.name]: cartRetention,
  [subnetExhaustion.name]: subnetExhaustion,
  [redisReshard.name]: redisReshard,
  [fxRatesStale.name]: fxRatesStale,
  [erpOrderSync.name]: erpOrderSync,
  [inventoryQueryRegression.name]: inventoryQueryRegression,
  [gatewayRouteTimeout.name]: gatewayRouteTimeout,
  [vaultSealed.name]: vaultSealed,
  [natAllowlist.name]: natAllowlist,
  [fraudRulePublish.name]: fraudRulePublish,
  [kmsQuota.name]: kmsQuota,
  [discountTypo.name]: discountTypo,
  [geoipRefresh.name]: geoipRefresh,
  [brokerDiskAlarm.name]: brokerDiskAlarm,
  [sessionsMaxmemory.name]: sessionsMaxmemory,
  [noisyNeighbour.name]: noisyNeighbour,
  [cdnCacheBypass.name]: cdnCacheBypass,
  [scaEnforcement.name]: scaEnforcement,
  [pimWeightUnits.name]: pimWeightUnits,
  [cartBadgePolling.name]: cartBadgePolling,
  [outlierEjection.name]: outlierEjection,
  [flagSdkDefaults.name]: flagSdkDefaults,
};
