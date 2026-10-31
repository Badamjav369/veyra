/**
 * SHIVNEE mark: a speech bubble (a message) with a keyhole cut into it (only the right key opens it).
 * Drawn on a 48×48 grid so it stays crisp from 16px favicons up to large sizes.
 */
export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className="logo-mark"
    >
      <path
        d="M17 6h14c6.6 0 11 4.4 11 11v7c0 6.6-4.4 11-11 11H20.5l-7.7 6.4c-1 .8-2.3.1-2.3-1.1V34.3C7.8 32.5 6 29 6 24v-7C6 10.4 10.4 6 17 6z"
        fill="var(--accent-deep)"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="18.2" r="4.3" fill="var(--accent)" />
      <path d="M22.1 21.2h3.8l1.3 7.6c.1.6-.3 1.2-1 1.2h-4.4c-.7 0-1.1-.6-1-1.2z" fill="var(--accent)" />
    </svg>
  );
}

/** Mark + wordmark. */
export function Logo({ size = 28, showWord = true }: { size?: number; showWord?: boolean }) {
  return (
    <span className="logo" aria-label="SHIVNEE" role="img">
      <LogoMark size={size} />
      {showWord && (
        <span className="logo__word" aria-hidden="true">
          SHIVNEE
        </span>
      )}
    </span>
  );
}
