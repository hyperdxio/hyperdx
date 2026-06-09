---
"@hyperdx/common-utils": patch
"@hyperdx/app": patch
"@hyperdx/api": patch
---

feat(charts): cap group-by time charts to a top-N series limit to prevent browser memory exhaustion on high-cardinality group-bys. The cap defaults to 60 (the number of series rendered) and is configurable per team via a new "Time Chart Series Limit" setting; series beyond the cap remain available in the series selector.
