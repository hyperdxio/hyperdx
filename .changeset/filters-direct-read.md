---
"@hyperdx/common-utils": minor
"@hyperdx/app": minor
---

feat: emit Lucene conditions from sidebar/dashboard filters to enable KV items direct_read optimization on Map columns

Legacy `type: 'sql'` filters in URLs are automatically migrated to Lucene
on page load. The persisted `DashboardFilter.expression` in MongoDB is unchanged.
