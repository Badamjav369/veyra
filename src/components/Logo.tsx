import { useId } from 'react';

/**
 * VEYRA mark: a chat bubble whose tail is a "V", with a padlock inside — private chat.
 * Colours follow the app accent (Settings → Appearance), so the mark always matches the site.
 */
export function LogoShapes({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8fd9b6" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" stopColor="#3f8f78" style={{ stopColor: 'color-mix(in srgb, var(--accent) 62%, #0d1012)' }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <path d="M17 10H47C50.3 10 53 12.7 53 16V34C53 37.3 50.3 40 47 40H39L32 55L25 40H17C13.7 40 11 37.3 11 34V16C11 12.7 13.7 10 17 10Z" fill="#fff" />
      <path d="M28 24V21.5a4 4 0 0 1 8 0V24" stroke={`url(#${id})`} strokeWidth="2.6" fill="none" />
      <rect x="25.5" y="24" width="13" height="10" rx="2.5" fill={`url(#${id})`} />
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
