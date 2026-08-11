---
'@hyperdx/app': patch
---

Fix search page filters on JSON columns generating invalid bracket access. Adding or excluding a value on a sub-key of a JSON-typed column (e.g. `ResourceAttributes.region`) previously serialized to `ResourceAttributes['region']`, which ClickHouse rejects on a JSON column ("First argument for function 'arrayElement' must be array, got 'JSON'"). Sub-keys of JSON columns now serialize with dot access (`ResourceAttributes.\`region\``).
