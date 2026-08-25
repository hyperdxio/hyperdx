---
'@hyperdx/app': patch
---

Show every notification channel on an alert's summary line, rather than only the first. `AlertPropertiesSummary` read `alert.channel` — the legacy single-value mirror of `channels[0]` — so an alert configured with several targets rendered as though it notified one, with nothing to indicate the others existed. Dispatch was always correct; this was a reporting gap, and it pointed the wrong way: someone checking which targets an alert notifies was shown one and would reasonably conclude a channel had not saved. A single-channel alert still names its webhook exactly as before; several channels now render an icon each plus a count. Affects both surfaces that share the component, the alerts page rows and the alert detail page.
