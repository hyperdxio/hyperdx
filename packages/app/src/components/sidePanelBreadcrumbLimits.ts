// Breadcrumb label truncation, kept apart from SidePanelBreadcrumbs so the side
// panel can check whether its title shows a label in full without depending on
// the component (which the side panel tests mock out).
const MAX_LABEL_LENGTH_SINGLE = 120;
const MAX_LABEL_LENGTH_CURRENT = 40;
const MAX_LABEL_LENGTH_PREVIOUS = 20;

/**
 * Longest label a crumb renders before truncating. A lone crumb is the panel
 * title and gets the most room; in a trail the current crumb gets more room
 * than its ancestors.
 */
export function getBreadcrumbMaxLabelLength(index: number, itemCount: number) {
  if (itemCount === 1) return MAX_LABEL_LENGTH_SINGLE;
  return index === itemCount - 1
    ? MAX_LABEL_LENGTH_CURRENT
    : MAX_LABEL_LENGTH_PREVIOUS;
}
