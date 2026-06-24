import type { CSSProperties, ReactNode } from 'react';
import { Box } from '@mantine/core';

/**
 * Layered shadow that gives the badge a soft, floating "tile" appearance.
 * Matches the ClickStack onboarding logo badge in Figma (1px ring + drop).
 */
export const LOGO_BADGE_SHADOW = ' var(--mantine-shadow-sm)';

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
  border?: string;
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
  background = 'var(--color-bg)',
  border = '1px solid var(--color-border)',
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
        border: dashed ? '1.25px dashed var(--color-border)' : border,
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
