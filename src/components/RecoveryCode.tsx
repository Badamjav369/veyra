import { useState } from 'react';
import { useI18n } from '../i18n';
import { CheckIcon, CopyIcon, DownloadIcon, KeyIcon, WarnIcon } from './Icons';
import { Modal } from './Modal';

/** Shows a recovery code once, with copy / download, and asks the person to confirm they saved it. */
export function RecoveryCodeView({ handle, code, onDone, doneLabel }: { handle: string; code: string; onDone: () => void; doneLabel: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is still on screen */
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([t('rc.fileText', { handle, code })], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `veyra-recovery-${handle}.txt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="rc">
      <p className="label">{t('rc.yourCode')}</p>
      <output className="rc__code" aria-live="polite">
        {code}
      </output>
      <div className="btn-row">
        <button type="button" className="btn btn--outline btn--small" onClick={() => void copy()}>
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? t('rc.copied') : t('rc.copy')}
        </button>
        <button type="button" className="btn btn--outline btn--small" onClick={download}>
          <DownloadIcon size={16} />
          {t('rc.download')}
        </button>
      </div>
      <p className="callout callout--warn">
        <WarnIcon size={16} />
        <span>{t('rc.why')}</span>
      </p>
      <label className="rc__confirm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('rc.saved')}
      </label>
      <button type="button" className="btn btn--primary btn--block" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}

/** Explains the recovery code and makes a new one (the old one stops working). */
export function RecoveryDialog({ handle, hasCode, onCreate, onClose }: { handle: string; hasCode: boolean; onCreate: () => Promise<string>; onClose: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={t('rc.title')} labelId="rc-title" onClose={onClose} width={460}>
      {code ? (
        <RecoveryCodeView handle={handle} code={code} onDone={onClose} doneLabel={t('rc.done')} />
      ) : (
        <div className="form">
          <p className="help help--body">{hasCode ? t('rc.newHint') : t('rc.intro')}</p>
          <div className="form__actions">
            <button type="button" className="btn btn--outline" onClick={onClose}>
              {t('rc.later')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setCode(await onCreate());
              }}
            >
              <KeyIcon size={16} />
              {busy ? t('common.working') : hasCode ? t('rc.new') : t('rc.create')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
