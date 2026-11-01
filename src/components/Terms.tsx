import { Modal } from './Modal';

export const TERMS_UPDATED = 'November 1, 2026';

/** Veyra's Terms of Service. English only, like the rest of the app. */
export function TermsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Terms of Service" labelId="terms-title" onClose={onClose} width={620}>
      <div className="terms">
        <p className="terms__updated">Last updated: {TERMS_UPDATED}</p>

        <h3>1. What Veyra is</h3>
        <p>
          Veyra is a free, experimental, end-to-end encrypted messenger made by an independent developer (“the developer”). It is not a company product and comes
          with no service guarantees. By creating an account or using Veyra you agree to these terms. If you don’t agree, don’t use Veyra.
        </p>

        <h3>2. Your account is your responsibility</h3>
        <ul>
          <li>Your handle, password and recovery code are the only way into your account. Keep them safe and never share them.</li>
          <li>
            Nobody — including the developer — can see, reset or recover your password or recovery code. If you lose both, your account and messages are gone for
            good.
          </li>
          <li>Accounts that nobody signs in to for 6 months are deleted automatically, and their handle becomes available again.</li>
          <li>You are responsible for the security of the devices you use Veyra on.</li>
        </ul>

        <h3>3. Privacy</h3>
        <ul>
          <li>Messages are encrypted on your device. The server cannot read them.</li>
          <li>
            The server stores only what it needs to work: your handle and public keys, encrypted messages until they are delivered (at most 30 days), and an
            encrypted copy of your account that it cannot open.
          </li>
          <li>The server can see technical information such as who a message is addressed to, when it was sent, and IP addresses.</li>
          <li>There are no ads and your data is not sold.</li>
        </ul>

        <h3>4. Acceptable use</h3>
        <p>You must not use Veyra to:</p>
        <ul>
          <li>break the law, or share illegal content;</li>
          <li>harass, threaten, or impersonate anyone;</li>
          <li>send spam, malware or scams;</li>
          <li>attack, overload or try to break into the service.</li>
        </ul>
        <p>You alone are responsible for the messages and files you send. The developer may remove accounts that abuse the service.</p>

        <h3>5. No warranty</h3>
        <p>
          Veyra is provided “as is” and “as available”, without any warranty of any kind. It may contain bugs, be interrupted, change, or be shut down at any time
          without notice. Accounts, messages and other data may be lost — for example when the service is reset or discontinued. The software has not been
          independently audited. Do not rely on Veyra where your safety, freedom or important interests depend on it.
        </p>

        <h3>6. Limitation of liability</h3>
        <p>
          To the fullest extent permitted by law, the developer is not responsible or liable for any problem, loss or damage arising from the use of Veyra or
          from being unable to use it. This includes, without limitation: lost or leaked data, messages or accounts; forgotten passwords or recovery codes;
          unauthorized access to your account or devices; content sent by other users; service interruptions or errors; and any direct, indirect or
          consequential damages. You use Veyra entirely at your own risk.
        </p>

        <h3>7. Changes</h3>
        <p>These terms may be updated. The date at the top shows the latest version. Continuing to use Veyra after a change means you accept the new terms.</p>
      </div>
    </Modal>
  );
}
