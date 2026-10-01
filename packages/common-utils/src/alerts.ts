import {
  MAX_ALERT_DISPLAY_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
} from './types';

/** Display name derived for a dashboard tile alert with no explicit displayName. */
export function formatTileAlertDisplayName(
  dashboardName: string,
  tileName?: string | null,
): string {
  return `${dashboardName} - ${tileName?.trim() || 'Tile'}`;
}

/**
 * Alerts cap displayName and tags (alertDisplayNameSchema / alertTagsSchema),
 * but the saved searches and dashboards they inherit from cap neither. Anything
 * copied across has to be clamped first or the alert form and API reject it.
 */
export function clampAlertDisplayName(name: string): string {
  return name.slice(0, MAX_ALERT_DISPLAY_NAME_LENGTH);
}

export function clampAlertTags(tags: readonly string[]): string[] {
  return tags
    .filter(tag => tag !== '')
    .slice(0, MAX_TAGS)
    .map(tag => tag.slice(0, MAX_TAG_LENGTH));
}
