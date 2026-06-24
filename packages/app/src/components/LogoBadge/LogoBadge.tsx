import type { CSSProperties, ReactNode } from 'react';
import { Box } from '@mantine/core';

/**
 * Layered "tile" shadow, inspired by Tailwind's composed shadow stack (a chain
 * of inset-shadow → inset-ring → ring → drop layers).
 *
 * The colors are driven by the theme token `--logo-badge-shadow`, which is
 * defined per color scheme in each theme's `_tokens.scss`: dark mode uses a
 * light-alpha ring + a stronger drop so the tile reads against dark surfaces,
 * while light mode uses a dark hairline ring + a soft drop. Referencing the
 * token (instead of hard-coded colors) is what makes the shadow work in both
 * light and dark mode. The fallback mirrors the light-mode value so the badge
 * is never shadowless outside the themed app (e.g. isolated rendering).
 */
export const LOGO_BADGE_SHADOW =
  'var(--logo-badge-shadow, inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 2px 0 rgb(0 0 0 / 0.08), 0 2px 4px -1px rgb(0 0 0 / 0.06))';

export interface LogoBadgeProps {
  /** Outer badge dimension in px. */
  size?: number;
  /** Corner radius in px. */
  radius?: number;
  /**
   * Badge background. Defaults to white so brand-colored logos stay legible
   * in both light and dark themes.
   */
  background?: string;
  className?: string;
  style?: CSSProperties;
  /** Logo rendered centered within the badge (e.g. a `react-icons` glyph). */
  children?: ReactNode;
  /**
   * Render an empty placeholder tile (dashed outline, no fill or shadow) to
   * hint that more integrations can be added.
   */
  dashed?: boolean;
}

/**
 * A square, shadowed tile that frames a single brand logo. Used to present
 * SDK / integration logos throughout onboarding. Pass `dashed` for an empty
 * "add more" placeholder.
 */
export function LogoBadge({
  size = 56,
  radius = 12,
  background = 'var(--color-bg-body)',
  dashed = false,
  className,
  style,
  children,
}: LogoBadgeProps) {
  return (
    <Box
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: dashed ? 'transparent' : background,
        border: dashed ? '1.25px dashed var(--color-border)' : '',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: dashed ? 'none' : LOGO_BADGE_SHADOW,
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </Box>
  );
}

export default LogoBadge;
