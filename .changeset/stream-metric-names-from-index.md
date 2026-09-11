---
'@hyperdx/common-utils': minor
'@hyperdx/app': minor
---

Fill the metric name select from the table's primary index, so it populates almost immediately instead of waiting on an aggregation over the data. On a source reporting ~4,900 gauge metrics the first options appear in ~30ms rather than ~770ms, and they stream in progressively rather than arriving all at once. A small spinner replaces the dropdown chevron while more are still on the way.

The picker now has two modes. **Browsing** streams `MetricName` out of the sparse primary index via the `mergeTreeIndex` table function — one row per granule mark instead of a full column scan. Because the index only records the value at each granule boundary, that list is a subset, weighted towards metrics that actually carry data (index-visible metrics have a median ~32k datapoints against ~14 for the rest). **Typing** switches to the exhaustive, relevance-ranked `GROUP BY` search, so any metric the index omitted is still reachable by name. The placeholder reads "Search metrics..." to invite that.

Two details that matter in use: while the first search for a pattern is in flight the browse list is held and filtered client-side, so the options never blank out mid-keystroke; and the dropdown's render cap is raised to 500 to match the server-side page size, so a search that is not reported as truncated is fully renderable.

Browsing falls back to the exhaustive listing when the index cannot be read at all — a server older than 24.2, a Distributed or non-MergeTree metric table, or a schema whose primary key omits `MetricName` — so no deployment loses the picker.

`Metadata` gains `streamDistinctIndexValues`, an async generator generic over table and column, so any primary-key column (`ServiceName`, for instance) can be listed the same way. `streamToAsyncIterator` moves from `packages/app`'s session code into `common-utils` beside the ClickHouse client, and a new `useStreamingQuery` hook accumulates an async iterable into a React Query cache entry, publishing partial results on a throttle.
