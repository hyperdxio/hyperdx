{{/*
Return the proper Docker Image Registry Secret Names
*/}}
{{- define "hyperdx.imagePullSecrets" -}}
{{- include "common.images.pullSecrets" (dict "images" (list .Values.app.image .Values.api.image .Values.ingestor.image .Values.aggregator.image .Values.goParser.image .Values.miner.image .Values.taskCheckAlerts.image .Values.otelCollector.image) "global" .Values.global) -}}
{{- end -}}

{{/*
Create the name of the service account to use
*/}}
{{- define "hyperdx.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
    {{ default (include "common.names.fullname" .) .Values.serviceAccount.name }}
{{- else -}}
    {{ default "default" .Values.serviceAccount.name }}
{{- end -}}
{{- end -}}

{{/*
Return the k8s secret name containing the API key
*/}}
{{- define  "hyperdx.apiKey.secretName" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "api-key" | trunc 63 | trimSuffix "-" -}}
{{- end -}}


{{/* ============================== */}}
{{/* App (dashboard) */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx app fullname
*/}}
{{- define "hyperdx.app.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "app" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx app image name
*/}}
{{- define "hyperdx.app.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.app.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the in cluster url for Hyperdx app
*/}}
{{- define "hyperdx.app.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.app.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.app.service.ports.http | toString) -}}
{{- end -}}

{{/*
Return the Hyperdx app public url 
*/}}
{{- define "hyperdx.app.publicUrl" -}}
{{- if .Values.publicUrl -}}
{{- printf .Values.publicUrl -}}
{{- else if (and (eq .Values.kong.service.type "LoadBalancer") .Values.kong.service.loadBalancerIP) -}}
{{- printf "http://%s:%d" .Values.kong.service.loadBalancerIP (int .Values.kong.service.ports.proxyHttp) -}}
{{- else -}}
{{- printf "http://localhost:%d" (int .Values.kong.service.ports.proxyHttp) -}}
{{- end -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (app)
*/}}
{{- define "hyperdx.app.defaultConfigmapName" -}}
{{- if .Values.app.existingConfigmap -}}
    {{- print .Values.app.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.app.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (app)
*/}}
{{- define "hyperdx.app.extraConfigmapName" -}}
{{- if .Values.app.extraConfigExistingConfigmap -}}
    {{- print .Values.app.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.app.fullname" .) -}}
{{- end -}}
{{- end -}}


{{/* ============================== */}}
{{/* Api */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx api fullname
*/}}
{{- define "hyperdx.api.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "api" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx api image name
*/}}
{{- define "hyperdx.api.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.api.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the in cluster url for Hyperdx api
*/}}
{{- define "hyperdx.api.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.api.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.api.service.ports.http | toString) -}}
{{- end -}}

{{/*
Return the Hyperdx api public url 
*/}}
{{- define "hyperdx.api.publicUrl" -}}
{{- if .Values.publicUrl -}}
{{- printf "%s/api/v1/" .Values.publicUrl -}}
{{- else if (and (eq .Values.kong.service.type "LoadBalancer") .Values.kong.service.loadBalancerIP) -}}
{{- printf "http://%s:%d/api/v1/" .Values.kong.service.loadBalancerIP (int .Values.kong.service.ports.proxyHttp) -}}
{{- else -}}
{{- printf "http://localhost:%d" (int .Values.api.containerPorts.http) -}}
{{- end -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (api)
*/}}
{{- define "hyperdx.api.defaultConfigmapName" -}}
{{- if .Values.api.existingConfigmap -}}
    {{- print .Values.api.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.api.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (api)
*/}}
{{- define "hyperdx.api.extraConfigmapName" -}}
{{- if .Values.api.extraConfigExistingConfigmap -}}
    {{- print .Values.api.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.api.fullname" .) -}}
{{- end -}}
{{- end -}}


{{/* ============================== */}}
{{/* Ingestor */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx ingestor fullname
*/}}
{{- define "hyperdx.ingestor.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "ingestor" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx ingestor image name
*/}}
{{- define "hyperdx.ingestor.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.ingestor.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the url for Hyperdx ingestor 
*/}}
{{- define "hyperdx.ingestor.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.ingestor.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.ingestor.service.ports.http | toString) -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (ingestor)
*/}}
{{- define "hyperdx.ingestor.defaultConfigmapName" -}}
{{- if .Values.ingestor.existingConfigmap -}}
    {{- print .Values.ingestor.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.ingestor.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (ingestor)
*/}}
{{- define "hyperdx.ingestor.extraConfigmapName" -}}
{{- if .Values.ingestor.extraConfigExistingConfigmap -}}
    {{- print .Values.ingestor.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.ingestor.fullname" .) -}}
{{- end -}}
{{- end -}}


{{/* ============================== */}}
{{/* Aggregator */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx aggregator fullname
*/}}
{{- define "hyperdx.aggregator.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "aggregator" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx aggregator image name
*/}}
{{- define "hyperdx.aggregator.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.aggregator.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the url for Hyperdx aggregator 
*/}}
{{- define "hyperdx.aggregator.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.aggregator.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.aggregator.service.ports.http | toString) -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (aggregator)
*/}}
{{- define "hyperdx.aggregator.defaultConfigmapName" -}}
{{- if .Values.aggregator.existingConfigmap -}}
    {{- print .Values.aggregator.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.aggregator.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (aggregator)
*/}}
{{- define "hyperdx.aggregator.extraConfigmapName" -}}
{{- if .Values.aggregator.extraConfigExistingConfigmap -}}
    {{- print .Values.aggregator.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.aggregator.fullname" .) -}}
{{- end -}}
{{- end -}}


{{/* ============================== */}}
{{/* Go parser */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx go parser fullname
*/}}
{{- define "hyperdx.goParser.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "go-parser" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx go parser image name
*/}}
{{- define "hyperdx.goParser.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.goParser.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the url for Hyperdx go parser 
*/}}
{{- define "hyperdx.goParser.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.goParser.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.goParser.service.ports.http | toString) -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (go parser)
*/}}
{{- define "hyperdx.goParser.defaultConfigmapName" -}}
{{- if .Values.goParser.existingConfigmap -}}
    {{- print .Values.goParser.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.goParser.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (go parser)
*/}}
{{- define "hyperdx.goParser.extraConfigmapName" -}}
{{- if .Values.goParser.extraConfigExistingConfigmap -}}
    {{- print .Values.goParser.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.goParser.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* ============================== */}}
{{/* Miner */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx miner fullname
*/}}
{{- define "hyperdx.miner.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "miner" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx miner image name
*/}}
{{- define "hyperdx.miner.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.miner.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the url for Hyperdx miner 
*/}}
{{- define "hyperdx.miner.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.miner.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.miner.service.ports.http | toString) -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (miner)
*/}}
{{- define "hyperdx.miner.defaultConfigmapName" -}}
{{- if .Values.miner.existingConfigmap -}}
    {{- print .Values.miner.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.miner.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (miner)
*/}}
{{- define "hyperdx.miner.extraConfigmapName" -}}
{{- if .Values.miner.extraConfigExistingConfigmap -}}
    {{- print .Values.miner.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.miner.fullname" .) -}}
{{- end -}}
{{- end -}}


{{/* ============================== */}}
{{/* Otel collector */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx otel collector fullname
*/}}
{{- define "hyperdx.otelCollector.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "otel-collector" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx otel collector image name
*/}}
{{- define "hyperdx.otelCollector.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.otelCollector.image "global" .Values.global) }}
{{- end -}}

{{/*
Return the url for Hyperdx otel collector 
*/}}
{{- define "hyperdx.otelCollector.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.otelCollector.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.otelCollector.service.ports.http | toString) -}}
{{- end -}}

{{/*
Default configuration ConfigMap name (otel collector)
*/}}
{{- define "hyperdx.otelCollector.defaultConfigmapName" -}}
{{- if .Values.otelCollector.existingConfigmap -}}
    {{- print .Values.otelCollector.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.otelCollector.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/*
Extra configuration ConfigMap name (otel collector)
*/}}
{{- define "hyperdx.otelCollector.extraConfigmapName" -}}
{{- if .Values.otelCollector.extraConfigExistingConfigmap -}}
    {{- print .Values.otelCollector.extraConfigExistingConfigmap -}}
{{- else -}}
    {{- printf "%s-extra" (include "hyperdx.otelCollector.fullname" .) -}}
{{- end -}}
{{- end -}}


{{/* ============================== */}}
{{/* Task check alerts */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx task check alerts fullname
*/}}
{{- define "hyperdx.taskCheckAlerts.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "task-check-alerts" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the proper Hyperdx task check alerts image name
*/}}
{{- define "hyperdx.taskCheckAlerts.image" -}}
{{ include "common.images.image" (dict "imageRoot" .Values.taskCheckAlerts.image "global" .Values.global) }}
{{- end -}}

{{/*
Default configuration ConfigMap name (task check alerts)
*/}}
{{- define "hyperdx.taskCheckAlerts.defaultConfigmapName" -}}
{{- if .Values.taskCheckAlerts.existingConfigmap -}}
    {{- print .Values.taskCheckAlerts.existingConfigmap -}}
{{- else -}}
    {{- printf "%s-default" (include "hyperdx.taskCheckAlerts.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* ========================================== */}}
{{/* Dependency charts */}}
{{/* ========================================== */}}

{{/* ============================== */}}
{{/* Kong */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx Kong fullname
*/}}
{{- define "hyperdx.kong.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "kong" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the url for Hyperdx Kong
*/}}
{{- define "hyperdx.kong.url" -}}
{{- printf "kong://%s.%s.svc.%s:%s" (include "hyperdx.kong.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.kong.service.ports.kong | toString) -}}
{{- end -}}


{{/* ============================== */}}
{{/* MongoDB */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx Mongodb fullname
*/}}
{{- define "hyperdx.mongodb.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "mongodb" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the url for Hyperdx Mongodb
*/}}
{{- define "hyperdx.mongodb.url" -}}
{{- printf "mongodb://%s.%s.svc.%s:%s" (include "hyperdx.mongodb.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.mongodb.service.ports.mongodb | toString) -}}
{{- end -}}

{{/*
Return the Mongodb Hostname
*/}}
{{- define "hyperdx.mongodb.host" -}}
{{- print "TODO:(anjiann)" -}}
{{- end -}}


{{/*
Return the Mongodb port
*/}}
{{- define "hyperdx.mongodb.port" -}}
{{- print "TODO:(anjiann)" -}}
{{- end -}}

{{/*
Return the Mongodb database name
*/}}
{{- define "hyperdx.mongodb.name" -}}
{{- print "hyperdx" -}}
{{- end -}}


{{/*
Return the Mongodb connection uri 
*/}}
{{- define "hyperdx.mongodb.uri" -}}
{{- printf "mongodb://%s.%s.svc.%s:%s/hyperdx" (include "hyperdx.mongodb.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.mongodb.service.ports.mongodb | toString) -}}
{{- end -}}


{{/* ============================== */}}
{{/* Clickhouse */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx clickhouse fullname
*/}}
{{- define "hyperdx.clickhouse.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "clickhouse" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the url for Hyperdx clickhouse 
*/}}
{{- define "hyperdx.clickhouse.url" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.clickhouse.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.clickhouse.service.ports.http | toString) -}}
{{- end -}}

{{/*
Return the Clickhouse Hostname
*/}}
{{- define "hyperdx.clickhouse.host" -}}
{{- printf "http://%s.%s.svc.%s:%s" (include "hyperdx.clickhouse.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.clickhouse.service.ports.http | toString) -}}
{{- end -}}


{{/* ============================== */}}
{{/* Redis standalone */}}
{{/* ============================== */}}
{{/*
Return the proper Hyperdx redis fullname
*/}}
{{- define "hyperdx.redis.fullname" -}}
{{- printf "%s-%s" (include "common.names.fullname" .) "redis-master" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Return the url for Hyperdx redis.
*/}}
{{- define "hyperdx.redis.url" -}}
{{- printf "redis://%s.%s.svc.%s:%s" (include "hyperdx.redis.fullname" .) (include "common.names.namespace" .) .Values.clusterDomain (.Values.redis.master.service.ports.redis | toString) -}}
{{- end -}}

