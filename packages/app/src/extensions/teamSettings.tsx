import { ReactNode } from 'react';

/**
 * Team settings extension points.
 *
 * `TeamPage` builds its tabs from a declarative list and renders them
 * generically. The two hooks below are the extension seam: builds that ship
 * additional team-settings surfaces can supply their own implementations of
 * this module (resolved via the `@/extensions` import) to contribute or
 * rearrange tabs and to gate administrative affordances, without editing
 * `TeamPage` itself. The defaults here preserve the standard behavior.
 */

export type TeamTab = {
  value: string;
  label: string;
  sections: {
    id: string;
    content: ReactNode;
  }[];
};

/**
 * Transform the team-settings tabs before they are rendered. Receives the
 * base tabs and returns the tabs to display. Default: unchanged.
 *
 * This is a hook so implementations may read state (current team, feature
 * flags, etc.) when deciding which tabs and sections to show.
 */
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- hook by contract: override implementations call hooks
export function useTeamSettingsTabs(tabs: TeamTab[]): TeamTab[] {
  return tabs;
}

/**
 * Whether the current user may administer the team (controls the team-name
 * edit affordance). Default: always allowed.
 */
// eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- hook by contract: override implementations call hooks
export function useTeamAdminAccess(): boolean {
  return true;
}
