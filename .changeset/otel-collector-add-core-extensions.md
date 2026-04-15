---
'@hyperdx/otel-collector': minor
---

feat: Add missing core extensions, commonly-used contrib processors/receivers, and filestorage extension

Add the two missing core extensions (memorylimiterextension, zpagesextension),
12 commonly-used contrib processors (attributes, filter, resource, k8sattributes,
tailsampling, probabilisticsampler, span, groupbyattrs, redaction, logdedup,
metricstransform, cumulativetodelta), 4 commonly-used contrib receivers
(filelog, dockerstats, k8scluster, kubeletstats), and the filestorage extension
(used for persistent sending queue in the clickhouse exporter) to
builder-config.yaml.
