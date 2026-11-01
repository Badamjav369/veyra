import { useMemo } from 'react';
import { identiconCells } from '../lib/visual';
import type { Avatar } from '../types';

interface Props {
  seed: string;
  color: string;
  size?: number;
  shape?: 'circle' | 'square';
}

/** A small mirrored pixel pattern used instead of profile photos (nothing to leak). */
export function Identicon({ seed, color, size = 40, shape = 'circle', photo }: Props & { photo?: string }) {
  const cells = useMemo(() => identiconCells(seed), [seed]);
  // A photo the contact shared with us (only image data URLs are shown).
  if (photo && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(photo)) {
    return (
      <span className={`identicon identicon--${shape} identicon--photo`} style={{ width: size, height: size }} aria-hidden="true">
        <img src={photo} alt="" width={size} height={size} />
      </span>
    );
  }
  return (
    <span className={`identicon identicon--${shape}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 5 5" width="50%" height="50%" shapeRendering="crispEdges">
        {cells.map((on, i) =>
          on ? <rect key={i} x={(i % 5) + 0.06} y={Math.floor(i / 5) + 0.06} width={0.88} height={0.88} fill={color} /> : null,
        )}
      </svg>
    </span>
  );
}

/** Your own avatar: a photo if you uploaded one, otherwise your pattern. */
export function ProfileAvatar({ avatar, size = 40 }: { avatar: Avatar; size?: number }) {
  if (avatar.kind === 'image') {
    return (
      <span className="identicon identicon--circle identicon--photo" style={{ width: size, height: size }} aria-hidden="true">
        <img src={avatar.dataUrl} alt="" width={size} height={size} />
      </span>
    );
  }
  return <Identicon seed={avatar.seed} color={avatar.color} size={size} />;
}

/** Overlapping identicons for a group's members. */
export function IdenticonStack({ people, size = 36 }: { people: { seed: string; color: string }[]; size?: number }) {
  return (
    <span className="identicon-stack" aria-hidden="true">
      {people.slice(0, 4).map((p) => (
        <Identicon key={p.seed} seed={p.seed} color={p.color} size={size} shape="square" />
      ))}
    </span>
  );
}
