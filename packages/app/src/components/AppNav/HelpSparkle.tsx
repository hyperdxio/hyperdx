import cx from 'classnames';
import { IconHelp } from '@tabler/icons-react';

import styles from './AppNav.module.scss';

// A single monochrome 4-point sparkle. `currentColor` so the CSS class controls
// the colour (the theme brand colour); several are scattered over the Help icon.
const SparkleGlyph = ({ className }: { className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" />
  </svg>
);

const SPARKLES = [
  styles.helpSparkleA,
  styles.helpSparkleB,
  styles.helpSparkleC,
];

/**
 * The Help nav icon, sparkling when there's a release this browser hasn't seen.
 *
 * Hand-rolled rather than a @tabler `IconSparkles`: the effect is several
 * differently-sized glyphs scattered around the "?" on staggered twinkle
 * delays, which a single static icon can't express (positions and animation
 * live in AppNav.module.scss).
 */
export const HelpSparkle = ({ hasUnseen }: { hasUnseen: boolean }) => (
  <span
    className={styles.helpIcon}
    {...(hasUnseen && {
      'data-testid': 'whats-new-sparkle',
      role: 'img',
      'aria-label': 'New updates available',
    })}
  >
    <IconHelp size={16} />
    {hasUnseen &&
      SPARKLES.map(sparkleStyle => (
        <SparkleGlyph
          key={sparkleStyle}
          className={cx(styles.helpSparkle, sparkleStyle)}
        />
      ))}
  </span>
);
