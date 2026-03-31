import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const HOUSE_RADIUS = 12;
const GRAVITY = 0.4;
const FLAP_VELOCITY = -7;
const HOUSE_SPEED = 2.5;
const OVERLAY_COLOR = 'rgba(0, 0, 0, 0.3)';
const SCORE_FONT = '24px "IBM Plex Mono", monospace';
const HIGH_SCORE_FONT = '16px "IBM Plex Mono", monospace';
const INFO_FONT = '14px "IBM Plex Mono", monospace';
const HIGH_SCORE_COLOR = '#FFD700';
const HIGH_SCORE_GLOW = 'rgba(255, 215, 0, 0.6)';

let _sessionHighScore = 0;

const CLICKHOUSE_SVG = `<svg width="103" height="104" viewBox="0 0 103 104" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M0 1.2C0 0.500001 0.500001 0 1.2 0H10.2C10.9 0 11.4 0.500001 11.4 1.2V101.9C11.4 102.6 10.9 103.1 10.2 103.1H1.2C0.500001 103.1 0 102.6 0 101.9V1.2Z" fill="#FAFF69"/>
<path d="M22.9 1.2C22.9 0.500001 23.4 0 24.1 0H33.1C33.8 0 34.3 0.500001 34.3 1.2V101.9C34.3 102.6 33.8 103.1 33.1 103.1H24.1C23.4 103.1 22.9 102.6 22.9 101.9V1.2Z" fill="#FAFF69"/>
<path d="M45.8 1.2C45.8 0.500001 46.3 0 47 0H56C56.7 0 57.2001 0.500001 57.2001 1.2V101.9C57.2001 102.6 56.7 103.1 56 103.1H47C46.3 103.1 45.8 102.6 45.8 101.9V1.2Z" fill="#FAFF69"/>
<path d="M68.7 1.2C68.7 0.500001 69.1999 0 69.8999 0H78.8999C79.5999 0 80.1 0.500001 80.1 1.2V101.9C80.1 102.6 79.5999 103.1 78.8999 103.1H69.8999C69.1999 103.1 68.7 102.6 68.7 101.9V1.2Z" fill="#FAFF69"/>
<path d="M91.6 41.3001C91.6 40.6001 92.1 40.1001 92.8 40.1001H101.8C102.5 40.1001 103 40.6001 103 41.3001V61.8001C103 62.5001 102.5 63.0001 101.8 63.0001H92.8C92.1 63.0001 91.6 62.5001 91.6 61.8001V41.3001Z" fill="#FAFF69"/>
</svg>`;

function loadClickHouseIcon(): HTMLImageElement {
  const img = new Image();
  const blob = new Blob([CLICKHOUSE_SVG], { type: 'image/svg+xml' });
  img.src = URL.createObjectURL(blob);
  return img;
}

interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readBarRects(container: HTMLElement): BarRect[] {
  const svg = container.querySelector('svg.recharts-surface');
  if (!svg) return [];

  const rects: BarRect[] = [];
  // Recharts bar rectangles are inside <g class="recharts-bar-rectangle"> elements
  const barGroups = svg.querySelectorAll('.recharts-bar-rectangle rect');
  barGroups.forEach(rect => {
    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const width = parseFloat(rect.getAttribute('width') || '0');
    const height = parseFloat(rect.getAttribute('height') || '0');
    if (width > 0 && height > 0) {
      rects.push({ x, y, width, height });
    }
  });

  return rects;
}

// Merge overlapping/adjacent bars at the same x position into single obstacles
function mergeBarRects(rects: BarRect[]): BarRect[] {
  if (rects.length === 0) return [];

  // Group by x position (bars stacked at same x)
  const byX = new Map<number, BarRect[]>();
  for (const r of rects) {
    const key = Math.round(r.x);
    if (!byX.has(key)) byX.set(key, []);
    byX.get(key)!.push(r);
  }

  const merged: BarRect[] = [];
  for (const group of byX.values()) {
    // Find bounding box of all rects at this x
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const r of group) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    merged.push({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    });
  }

  return merged.sort((a, b) => a.x - b.x);
}

const ICON_SIZE = HOUSE_RADIUS * 2;

function drawHouse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  velocity: number,
  icon: HTMLImageElement,
) {
  ctx.save();
  ctx.translate(x, y);

  // Tilt based on velocity
  const angle = Math.max(-0.5, Math.min(0.5, velocity * 0.05));
  ctx.rotate(angle);

  ctx.drawImage(icon, -ICON_SIZE / 2, -ICON_SIZE / 2, ICON_SIZE, ICON_SIZE);

  ctx.restore();
}

interface FlappyHouseGameProps {
  containerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

export default function FlappyHouseGame({
  containerRef,
  onClose,
}: FlappyHouseGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const iconRef = useRef<HTMLImageElement>(loadClickHouseIcon());
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Game state refs (using refs to avoid re-renders during game loop)
  const houseRef = useRef({ x: 50, y: 100, velocity: 0 });
  const scoreRef = useRef(0);
  const passedBarsRef = useRef(new Set<number>());
  const gameOverRef = useRef(false);
  const startedRef = useRef(false);
  const barsRef = useRef<BarRect[]>([]);
  const animFrameRef = useRef<number>(0);
  const highScoreRef = useRef(_sessionHighScore);
  const newHighScoreTimeRef = useRef(0); // timestamp when new high score was hit

  // Read bar positions from the chart SVG and keep them in sync
  const refreshBars = useCallback(() => {
    if (!containerRef.current) return;
    const raw = readBarRects(containerRef.current);
    barsRef.current = mergeBarRects(raw);
  }, [containerRef]);

  // Initial read + observe DOM mutations to re-read when chart updates
  useLayoutEffect(() => {
    refreshBars();

    if (!containerRef.current) return;
    const observer = new MutationObserver(() => {
      refreshBars();
    });
    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['x', 'y', 'width', 'height', 'd'],
    });
    return () => observer.disconnect();
  }, [containerRef, refreshBars]);

  // Set canvas size to match container, and update on resize
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [containerRef]);

  const resetGame = useCallback(() => {
    houseRef.current = {
      x: 50,
      y: canvasSize.height / 2,
      velocity: 0,
    };
    scoreRef.current = 0;
    passedBarsRef.current = new Set();
    gameOverRef.current = false;
    startedRef.current = false;
  }, [canvasSize.height]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const chartHeight = canvasSize.height;
    const chartWidth = canvasSize.width;

    function gameLoop() {
      if (!ctx) return;

      // Read bars from ref each frame so they stay in sync with chart updates
      const bars = barsRef.current;
      const house = houseRef.current;

      if (startedRef.current && !gameOverRef.current) {
        // Physics
        house.velocity += GRAVITY;
        house.y += house.velocity;
        house.x += HOUSE_SPEED;

        // Wrap around
        if (house.x > chartWidth + HOUSE_RADIUS) {
          house.x = -HOUSE_RADIUS;
          passedBarsRef.current.clear();
        }

        // Floor/ceiling collision
        if (house.y + HOUSE_RADIUS > chartHeight) {
          house.y = chartHeight - HOUSE_RADIUS;
          gameOverRef.current = true;
        }
        if (house.y - HOUSE_RADIUS < 0) {
          house.y = HOUSE_RADIUS;
          house.velocity = 0;
        }

        // Bar collision
        for (let i = 0; i < bars.length; i++) {
          const bar = bars[i];
          const houseLeft = house.x - HOUSE_RADIUS;
          const houseRight = house.x + HOUSE_RADIUS;
          const houseTop = house.y - HOUSE_RADIUS * 0.8;
          const houseBottom = house.y + HOUSE_RADIUS * 0.8;

          const barRight = bar.x + bar.width;
          const barBottom = bar.y + bar.height;

          if (
            houseRight > bar.x &&
            houseLeft < barRight &&
            houseBottom > bar.y &&
            houseTop < barBottom
          ) {
            gameOverRef.current = true;
            break;
          }

          // Score: passed a bar
          if (house.x > barRight && !passedBarsRef.current.has(i)) {
            passedBarsRef.current.add(i);
            scoreRef.current++;

            // Check for new high score
            if (scoreRef.current > highScoreRef.current) {
              highScoreRef.current = scoreRef.current;
              _sessionHighScore = scoreRef.current;
              newHighScoreTimeRef.current = Date.now();
            }
          }
        }
      }

      // Draw
      ctx.clearRect(0, 0, chartWidth, chartHeight);

      // Semi-transparent overlay
      ctx.fillStyle = OVERLAY_COLOR;
      ctx.fillRect(0, 0, chartWidth, chartHeight);

      // Draw bars as highlights
      ctx.fillStyle = 'rgba(80, 250, 123, 0.4)';
      ctx.strokeStyle = 'rgba(80, 250, 123, 0.8)';
      ctx.lineWidth = 1;
      for (const bar of bars) {
        ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
        ctx.strokeRect(bar.x, bar.y, bar.width, bar.height);
      }

      // Draw house
      drawHouse(ctx, house.x, house.y, house.velocity, iconRef.current);

      // Score
      ctx.fillStyle = '#FFF';
      ctx.font = SCORE_FONT;
      ctx.textAlign = 'center';
      ctx.fillText(`${scoreRef.current}`, chartWidth / 2, 35);

      // High score display
      if (highScoreRef.current > 0) {
        const msSinceNewHighScore = Date.now() - newHighScoreTimeRef.current;
        const isCelebrating = msSinceNewHighScore < 2000;

        if (isCelebrating) {
          // Pulsing gold glow animation
          const pulse = Math.sin(msSinceNewHighScore / 150) * 0.3 + 0.7;
          ctx.save();
          ctx.shadowColor = HIGH_SCORE_GLOW;
          ctx.shadowBlur = 12 * pulse;
          ctx.fillStyle = HIGH_SCORE_COLOR;
          ctx.font = HIGH_SCORE_FONT;
          ctx.fillText(
            `NEW HIGH SCORE: ${highScoreRef.current}`,
            chartWidth / 2,
            60,
          );
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255, 215, 0, 0.5)';
          ctx.font = INFO_FONT;
          ctx.fillText(
            `High Score: ${highScoreRef.current}`,
            chartWidth / 2,
            58,
          );
        }
      }

      // Instructions
      if (!startedRef.current) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = INFO_FONT;
        ctx.fillText('Press SPACE to start flapping!', chartWidth / 2, chartHeight / 2 + 30);
        ctx.fillText('Press ESC to exit', chartWidth / 2, chartHeight / 2 + 52);
      }

      if (gameOverRef.current) {
        const isNewHighScore =
          scoreRef.current > 0 &&
          scoreRef.current >= highScoreRef.current;
        const boxHeight = isNewHighScore ? 115 : 90;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(
          chartWidth / 2 - 120,
          chartHeight / 2 - 40,
          240,
          boxHeight,
        );
        ctx.fillStyle = '#FF6347';
        ctx.font = SCORE_FONT;
        ctx.fillText('Game Over!', chartWidth / 2, chartHeight / 2 - 5);
        ctx.fillStyle = '#FFF';
        ctx.font = INFO_FONT;
        ctx.fillText(
          `Score: ${scoreRef.current}`,
          chartWidth / 2,
          chartHeight / 2 + 20,
        );

        if (isNewHighScore) {
          const pulse =
            Math.sin(Date.now() / 150) * 0.3 + 0.7;
          ctx.save();
          ctx.shadowColor = HIGH_SCORE_GLOW;
          ctx.shadowBlur = 10 * pulse;
          ctx.fillStyle = HIGH_SCORE_COLOR;
          ctx.fillText(
            'NEW HIGH SCORE!',
            chartWidth / 2,
            chartHeight / 2 + 40,
          );
          ctx.restore();
          ctx.fillStyle = '#FFF';
          ctx.fillText(
            'SPACE to retry • ESC to exit',
            chartWidth / 2,
            chartHeight / 2 + 62,
          );
        } else {
          ctx.fillText(
            'SPACE to retry • ESC to exit',
            chartWidth / 2,
            chartHeight / 2 + 40,
          );
        }
      }

      animFrameRef.current = requestAnimationFrame(gameLoop);
    }

    animFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [canvasSize]);

  // Keyboard handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (gameOverRef.current) {
          resetGame();
          startedRef.current = true;
          houseRef.current.velocity = FLAP_VELOCITY;
        } else if (!startedRef.current) {
          startedRef.current = true;
          houseRef.current.velocity = FLAP_VELOCITY;
        } else {
          houseRef.current.velocity = FLAP_VELOCITY;
        }
      }
      if (e.code === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, resetGame]);

  // Initialize house position
  useEffect(() => {
    if (canvasSize.height > 0) {
      houseRef.current.y = canvasSize.height / 2;
    }
  }, [canvasSize.height]);

  return (
    <canvas
      ref={canvasRef}
      width={canvasSize.width}
      height={canvasSize.height}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 10,
        cursor: 'pointer',
      }}
      tabIndex={0}
    />
  );
}
