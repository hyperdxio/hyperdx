const VIEWBOX_WIDTH = 38.7979;
const VIEWBOX_HEIGHT = 44.7998;

/**
 * ClickStack mark from the hexagon-and-bolt symbol.
 * The bolt uses the page background so it stays two-tone: white on the dark
 * surface, dark on the light one.
 *
 * `size` is the box height. The default box is square, which is what the
 * collapsed rail and the other callers size against. `fit="symbol"` hugs the
 * hexagon, which is taller than it is wide, and is what the wordmark uses.
 */
export default function Logomark({
  size = 16,
  fit = 'square',
}: {
  size?: number;
  fit?: 'square' | 'symbol';
}) {
  const width =
    fit === 'symbol' ? size * (VIEWBOX_WIDTH / VIEWBOX_HEIGHT) : size;

  return (
    <svg
      width={width}
      height={size}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      fill="none"
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M38.7979 11.2002V33.5996L19.3994 44.7998L0 33.5996V11.2002L19.3994 0L38.7979 11.2002Z"
      />
      <path
        fill="var(--color-bg-body)"
        d="M24.2434 7.39081C24.5455 7.61204 24.6866 8.0663 24.5838 8.48686L21.8763 19.5618H26.8722C27.1721 19.5618 27.4433 19.7862 27.5622 20.1326C27.6812 20.4791 27.6251 20.8814 27.4196 21.1563L15.3924 37.2399C15.1527 37.5603 14.7692 37.6305 14.467 37.4093C14.1649 37.188 14.0237 36.7338 14.1266 36.3132L16.834 25.2383H11.8382C11.5383 25.2383 11.2671 25.0139 11.1481 24.6675C11.0291 24.321 11.0852 23.9187 11.2908 23.6438L23.318 7.56021C23.5576 7.23979 23.9411 7.16958 24.2434 7.39081Z"
      />
    </svg>
  );
}
