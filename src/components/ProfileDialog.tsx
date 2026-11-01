import { useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { randomBytes, toB64 } from '../lib/crypto';
import { useToast } from '../lib/toast';
import { readableAccent, usePrefs } from '../prefs';
import type { Avatar, Presence, Profile } from '../types';
import { PALETTE } from '../types';
import { ColorPicker, Segmented } from './controls';
import { CopyIcon, ShuffleIcon, TrashIcon, UploadIcon } from './Icons';
import { ProfileAvatar } from './Identicon';
import { Modal } from './Modal';
import { copyText } from './dialogs';
import { contactCode } from '../lib/crypto';

const PRESENCE: Presence[] = ['online', 'away', 'dnd', 'hidden'];

/** Shrinks an image to a 256px square JPEG so it fits comfortably in the vault. */
function toAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

export function ProfileDialog({
  profile,
  onSave,
  onClose,
}: {
  profile: Profile;
  onSave: (p: Profile) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const notify = useToast();
  const { prefs } = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile.displayName);
  const handle = profile.handle;
  const [bio, setBio] = useState(profile.bio);
  const [presence, setPresence] = useState<Presence>(profile.presence);
  const [avatar, setAvatar] = useState<Avatar>(profile.avatar);
  const [error, setError] = useState('');

  const colors = [readableAccent(prefs.accent), ...PALETTE.filter((c) => c.toLowerCase() !== readableAccent(prefs.accent).toLowerCase())].slice(0, 7);

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await toAvatarDataUrl(file);
      setAvatar({ kind: 'image', dataUrl, color: avatar.color, seed: avatar.seed });
    } catch {
      notify(t('profile.imageError'), 'error');
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return setError(t('profile.nameRequired'));
    onSave({ ...profile, displayName: displayName.trim(), handle, bio: bio.trim(), presence, avatar });
    notify(t('profile.saved'));
    onClose();
  };

  return (
    <Modal title={t('profile.title')} labelId="profile-title" onClose={onClose} width={520}>
      <form className="form" onSubmit={save}>
        <div className="avatar-editor">
          <div className="avatar-editor__preview">
            <ProfileAvatar avatar={avatar} size={96} />
            <span className={`presence-dot presence-dot--${presence}`} aria-hidden="true" />
          </div>
          <div className="avatar-editor__controls">
            <span className="label">{t('profile.avatar')}</span>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn--outline btn--small"
                onClick={() => setAvatar({ kind: 'identicon', seed: toB64(randomBytes(9)), color: avatar.color })}
              >
                <ShuffleIcon size={15} />
                {t('profile.shuffle')}
              </button>
              <button type="button" className="btn btn--outline btn--small" onClick={() => fileRef.current?.click()}>
                <UploadIcon size={15} />
                {t('profile.upload')}
              </button>
              {avatar.kind === 'image' && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setAvatar({ kind: 'identicon', seed: avatar.seed, color: avatar.color })}
                >
                  <TrashIcon size={15} />
                  {t('profile.removePhoto')}
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void pickImage(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            <span className="label">{t('profile.color')}</span>
            <ColorPicker
              label={t('profile.color')}
              value={avatar.color}
              colors={colors}
              customLabel={t('settings.custom')}
              onChange={(c) => setAvatar({ ...avatar, color: c })}
            />
          </div>
        </div>

        <div className="form__grid">
          <div className="form__row">
            <label htmlFor="p-name" className="label">
              {t('profile.displayName')}
            </label>
            <div className="field">
              <input id="p-name" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
          </div>
          <div className="form__row">
            <label htmlFor="p-handle" className="label">
              {t('profile.handle')}
            </label>
            <div className="field">
              <span className="field__prefix" aria-hidden="true">
                @
              </span>
              <input id="p-handle" value={handle} readOnly aria-describedby="p-handle-hint" />
            </div>
            <small id="p-handle-hint" className="help help--small">
              {t('profile.handleFixed')}
            </small>
          </div>
        </div>

        <div className="form__row">
          <label htmlFor="p-bio" className="label">
            {t('profile.bio')}
          </label>
          <textarea
            id="p-bio"
            className="textarea"
            rows={2}
            maxLength={140}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t('profile.bioPh')}
          />
          <small className="counter">{bio.length}/140</small>
        </div>

        <div className="form__row">
          <span className="label">{t('profile.presence')}</span>
          <Segmented
            label={t('profile.presence')}
            value={presence}
            onChange={setPresence}
            options={PRESENCE.map((p) => ({
              value: p,
              label: (
                <span className="presence-option">
                  <span className={`presence-dot presence-dot--${p} presence-dot--inline`} aria-hidden="true" />
                  {t(`presence.${p}`)}
                </span>
              ),
            }))}
          />
        </div>

        <dl className="facts">
          <div>
            <dt>{t('profile.identity')}</dt>
            <dd className="mono">{profile.fingerprint}</dd>
          </div>
          <div>
            <dt>{t('profile.keyType')}</dt>
            <dd>Ed25519 + X25519</dd>
          </div>
          <div>
            <dt>{t('profile.created')}</dt>
            <dd>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(profile.createdAt)}</dd>
          </div>
        </dl>

        <button
          type="button"
          className="btn btn--ghost btn--small btn--start"
          onClick={async () => {
            if (await copyText(contactCode(handle, profile.publicKey))) notify(t('contact.copied'));
          }}
        >
          <CopyIcon size={14} />
          {t('contact.myCode')}
        </button>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('profile.cancel')}
          </button>
          <button type="submit" className="btn btn--primary">
            {t('profile.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
