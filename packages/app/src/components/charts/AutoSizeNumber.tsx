import { useLayoutEffect, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { Flex, Text } from '@mantine/core';

const NUMBER_TILE_MIN_FONT_SIZE = 10;
const NUMBER_TILE_MAX_FONT_SIZE = 72;
// Initial / fallback font size used before the first measurement runs
// (and as a sensible mid-range size if measurement is unavailable).
// Tuned to look reasonable in a typical "default" tile (~6 columns wide
// on a 24-col grid) without overflowing.
const NUMBER_TILE_DEFAULT_FONT_SIZE = 36;
const NUMBER_TILE_PADDING = 12;

function fitFontSize(
  textEl: HTMLElement,
  availableWidth: number,
  availableHeight: number,
  minFontSize: number,
  maxFontSize: number,
): number {
  if (availableWidth <= 0 || availableHeight <= 0) {
    return minFontSize;
  }

  let lo = minFontSize;
  let hi = maxFontSize;
  let best = minFontSize;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    textEl.style.fontSize = `${mid}px`;
    if (
      textEl.scrollWidth <= availableWidth &&
      textEl.scrollHeight <= availableHeight
    ) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

// Plain centered rendering used as a fallback when AutoSizeNumber's
// measurement / ResizeObserver pipeline throws unexpectedly. Mirrors the
// pre-auto-size implementation so dashboards keep showing the value even
// if the resize logic encounters a runtime error.
type NumberValueProps = {
  children: React.ReactNode;
  color?: string;
  'data-testid'?: string;
};

function SimpleNumber({
  children,
  color,
  'data-testid': testId,
}: NumberValueProps) {
  return (
    <Flex align="center" justify="center" h="100%" style={{ flexGrow: 1 }}>
      <Text size="4rem" c={color} data-testid={testId}>
        {children}
      </Text>
    </Flex>
  );
}

// Renders the formatted number at the largest font size (between
// NUMBER_TILE_MIN_FONT_SIZE and NUMBER_TILE_MAX_FONT_SIZE) that fits the
// surrounding tile, recomputing whenever the tile resizes or the value
// changes. Prevents long values (large counts, currency, percentages)
// from overflowing small dashboard tiles.
function AutoSizeNumber({
  children,
  color,
  'data-testid': testId,
}: NumberValueProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const [fontSize, setFontSize] = useState<number>(
    NUMBER_TILE_DEFAULT_FONT_SIZE,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    let raf: number | null = null;
    const recalc = () => {
      raf = null;
      if (!container || !textEl) return;
      const availW = container.clientWidth - NUMBER_TILE_PADDING * 2;
      const availH = container.clientHeight - NUMBER_TILE_PADDING * 2;
      const next = fitFontSize(
        textEl,
        availW,
        availH,
        NUMBER_TILE_MIN_FONT_SIZE,
        NUMBER_TILE_MAX_FONT_SIZE,
      );
      setFontSize(next);
    };

    recalc();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const ro = new ResizeObserver(() => {
      if (raf != null) return;
      raf = requestAnimationFrame(recalc);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [children]);

  return (
    <Flex
      ref={containerRef}
      align="center"
      justify="center"
      h="100%"
      w="100%"
      style={{
        flexGrow: 1,
        overflow: 'hidden',
        padding: NUMBER_TILE_PADDING,
      }}
    >
      <Text
        ref={textRef}
        c={color}
        data-testid={testId}
        style={{
          fontSize,
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </Text>
    </Flex>
  );
}

// Wraps AutoSizeNumber in an error boundary so a runtime failure in the
// measurement / ResizeObserver pipeline never blanks out the tile;
// instead the dashboard falls back to the original fixed-size rendering.
export function SafeAutoSizeNumber(props: NumberValueProps) {
  return (
    <ErrorBoundary fallback={<SimpleNumber {...props} />}>
      <AutoSizeNumber {...props} />
    </ErrorBoundary>
  );
}
