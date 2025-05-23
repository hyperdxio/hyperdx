Implements an HTTP OpAMP server that serves configurations to supervised
collectors.

Spec: https://github.com/open-telemetry/opamp-spec/tree/main

Workflow:

- Sup pings /v1/opamp with status
- Server checks if configs should be updated
- Return new config if current config is outdated
  - Config derived from team doc with ingestion api key
