import { useEffect, useRef } from 'react';

interface Props {
  color: string;
  /** Background the trails fade into — should match the surface behind the canvas. */
  background?: string;
  density?: number; // pixels between columns
  className?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const n = parseInt(v.length === 3 ? v.split('').map((c) => c + c).join('') : v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A slow stream of 0s and 1s. Purely decorative: hidden from screen readers,
 * paused when the tab is hidden, and frozen for people who prefer reduced motion.
 */
export function BinaryRain({ color, background = '#0D1012', density = 20, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const [r, g, b] = hexToRgb(color);
    const [br, bg, bb] = hexToRgb(background);
    const fontSize = 13;
    let drops: number[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${fontSize}px "JetBrains Mono", ui-monospace, monospace`;
      const columns = Math.ceil(width / density);
      drops = Array.from({ length: columns }, () => Math.random() * (height / fontSize));
      if (reduced) drawStatic();
    };

    const drawStatic = () => {
      for (let i = 0; i < drops.length; i++) {
        for (let y = 0; y < height / fontSize; y += 1) {
          if (Math.random() > 0.18) continue;
          ctx.fillStyle = `rgba(${r},${g},${b},${0.05 + Math.random() * 0.12})`;
          ctx.fillText(Math.random() > 0.5 ? '1' : '0', i * density + 4, y * fontSize);
        }
      }
    };

    const step = (time: number) => {
      frame = requestAnimationFrame(step);
      if (time - last < 70 || document.hidden) return; // ~14 fps is plenty for a calm background
      last = time;
      ctx.fillStyle = `rgba(${br},${bg},${bb},0.09)`;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i] * fontSize;
        ctx.fillStyle = `rgba(${r},${g},${b},${0.22 + Math.random() * 0.2})`;
        ctx.fillText(Math.random() > 0.5 ? '1' : '0', i * density + 4, y);
        if (y > height && Math.random() > 0.97) drops[i] = 0;
        else drops[i] += Math.random() > 0.35 ? 1 : 0;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    if (!reduced) frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [color, background, density]);

  return <canvas ref={ref} className={`binary-rain ${className ?? ''}`} aria-hidden="true" />;
}
