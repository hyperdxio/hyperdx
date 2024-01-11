---
'@hyperdx/api': minor
'@hyperdx/app': minor
---

Breaking Search Syntax Change: Backslashes will be treated as an escape
character for a double quotes (ex. message:"\"" will search for the double quote
character). Two backslashes will be treated as a backslash literal (ex.
message:\\ will search for the backslash literal)
