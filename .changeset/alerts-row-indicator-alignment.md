---
'@hyperdx/app': patch
---

Give every alerts-page row the same trailing controls. The row's Terraform import button, source link, and acknowledgement button were each independently conditional — import needs a saved-search alert *and* the export feature, and `AckAlert` renders nothing for an OK alert that has never been acknowledged — so the flex row collapsed differently per alert and no two rows lined up. The conditional actions move into an overflow menu that always renders, alongside a new "Delete alert" item, and the acknowledgement button gets a reserved slot so its absence no longer shifts everything to its left.

The Terraform snippet building is extracted into a `useTerraformSnippets` hook so the row menu can present the same snippets in a modal without duplicating it, or moving `ResourceTerraformPopover` off the two other pages that use it. Snippets are still built lazily on open, which is what keeps `window.location.origin` out of the render path and the ClickStack static export building.
