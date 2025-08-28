---
"@hyperdx/common-utils": patch
"@hyperdx/api": patch
"@hyperdx/app": patch
---

- deprecate unused packages/api/src/clickhouse
- deprecate unused route /datasources
- introduce getJSNativeCreateClient in common-utils
- uninstall @clickhouse/client in api package
- uninstall @clickhouse/client + @clickhouse/client-web in app package
- bump @clickhouse/client in common-utils package to v1.12.1
