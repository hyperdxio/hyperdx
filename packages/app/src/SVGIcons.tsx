// Only use this file if you can't find any icon in tabler icons

import type { CSSProperties, Ref } from 'react';
import type { IconProps as TablerIconProps } from '@tabler/icons-react';

type IconProps = {
  style?: CSSProperties;
  width?: number;
};

/**
 * Custom "AI notebook" icon (a document with a sparkle).
 *
 * Built to behave like a `@tabler/icons-react` outline icon so it's a drop-in
 * replacement: it defaults `stroke="currentColor"` (so the stroke follows the
 * active theme's text color, light or dark) and accepts the same `size` /
 * `stroke` / `color` / `title` props. The artwork is drawn on Tabler's 24×24
 * grid, so the viewBox and every default match Tabler's outline icons exactly.
 */
export function IconAiNotebook({
  color = 'currentColor',
  size = 24,
  stroke = 2,
  title,
  className,
  ref,
  ...rest
}: TablerIconProps & { ref?: Ref<SVGSVGElement> }) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['tabler-icon', 'tabler-icon-ai-notebook', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d="M20.5454 12.0001V5.74855C20.5454 5.44489 20.4249 5.15355 20.2102 4.93868L17.0614 1.79007L17.0202 1.75086C16.8102 1.56072 16.5365 1.4546 16.2516 1.45459H4.60004C3.96743 1.45459 3.45459 1.96743 3.45459 2.60004V21.4001C3.45461 22.0326 3.96741 22.5456 4.60004 22.5456H11" />
      <path d="M15.4546 2V5.40004C15.4546 6.0326 15.9674 6.54549 16.6 6.54549H20C20.3012 6.54549 20.5454 6.30127 20.5454 6.00004" />
      <path d="M7 5H11M7 9H13M7 13H10" />
      <path d="M16.6109 18.711C15.5795 19.7425 15 21.1414 15 22.6001C15 21.1414 14.4205 19.7425 13.3891 18.711C12.3576 17.6796 10.9587 17.1001 9.5 17.1001C10.9587 17.1001 12.3576 16.5206 13.3891 15.4892C14.4205 14.4577 15 13.0588 15 11.6001C15 13.0588 15.5795 14.4577 16.6109 15.4892C17.6424 16.5206 19.0413 17.1001 20.5 17.1001C19.0413 17.1001 17.6424 17.6796 16.6109 18.711Z" />
    </svg>
  );
}

export function IncidentIOIcon({ style, width }: IconProps) {
  return (
    <svg
      width={width}
      height={width}
      viewBox="0 0 128 163"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      preserveAspectRatio="xMidYMid"
      style={style}
    >
      <title>Incident.io</title>
      <g clipPath="url(#clip0_1361_12546)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M48.7336 139.642V163C20.7585 156.323 0 131.711 0 102.372C0 85.4557 7.15792 72.0354 18.1053 58.8703C27.1831 47.9534 49.5985 19.0426 56.6543 3.08954C58.3673 -0.783473 62.7348 -0.633805 64.6182 1.44721C70.6432 8.10421 78.0694 22.6432 80.4983 39.135C80.9932 42.4953 81.1969 45.2388 81.3587 47.4184C81.706 52.0954 81.8604 54.1748 84.2854 54.1748C88.0955 54.1748 90.588 48.3977 91.1358 42.4345C91.4869 38.6136 95.2774 37.3346 97.8914 38.6136C110.463 44.7644 123.292 74.0426 126.393 88.4102C127.366 92.9158 128 97.5719 128 102.372C128 131.646 107.335 156.214 79.4537 162.955V139.642H48.7336ZM64.0002 130.333C73.8316 130.333 81.8016 122.789 81.8016 113.483C81.8016 98.6407 70.8577 88.0345 65.4048 84.8105C65.0364 84.5928 64.8523 84.4839 64.3512 84.4974C63.9843 84.5073 63.4429 84.7369 63.181 84.9935C62.8232 85.3441 62.7283 85.743 62.5387 86.5409C61.5721 90.6065 58.5292 93.5054 55.327 96.556C50.9141 100.76 46.1988 105.252 46.1988 113.483C46.1988 122.789 54.1688 130.333 64.0002 130.333Z"
          fill="currentColor"
        />
      </g>
      <defs>
        <clipPath id="clip0_1361_12546">
          <rect width="128" height="163" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
