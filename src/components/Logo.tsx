import { useId } from 'react';

/**
 * VEYRA mark: a "V" folded like paper — a sealed note, lit on one side and shaded on the other.
 * Drawn on a 64×64 grid so it stays crisp from 16px favicons up to large sizes.
 */
export function LogoShapes({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="0.55" stopColor="#7fc8d9" />
          <stop offset="1" stopColor="#b9a2f0" />
        </linearGradient>
      </defs>
      <path d="M8 12H24L32 38V56Z" fill={`url(#${id})`} />
      <path d="M56 12H40L32 38V56Z" fill={`url(#${id})`} opacity="0.5" />
      <path d="M24 12L32 38L40 12" stroke="#0d1012" strokeWidth="1.5" opacity="0.6" />
    </>
  );
}

export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  const id = `veyra-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo-mark">
      <LogoShapes id={id} />
    </svg>
  );
}

/** Mark + wordmark. */
export function Logo({ size = 28, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <span className="logo" aria-label="VEYRA" role="img">
      <LogoMark size={size} />
      {showWord && (
        <span className="logo__word" aria-hidden="true">
          VEYRA
        </span>
      )}
    </span>
  );
}
