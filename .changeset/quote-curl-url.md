---
'@hyperdx/app': patch
---

fix: Quote the URL in "Copy Request as Curl"

The generated command interpolated `http.url` unquoted, so a URL with a query
string was cut short at the first `&`: pasting the snippet for
`/v1/search?q=checkout&page=2` dropped `page=2` and severed `-X GET` and every
header into a second command that failed with `-X: command not found`. The URL
now goes through the same POSIX escaper the request body already uses.
