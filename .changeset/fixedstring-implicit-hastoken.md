---
'@hyperdx/common-utils': patch
'@hyperdx/api': patch
'@hyperdx/app': patch
---

fix: cast FixedString columns before implicit hasToken search

A bare search term against a FixedString column such as OTel TraceId compiled to
hasToken(lower(TraceId), ...), which ClickHouse rejects. Those haystacks are now
CAST to String first.
