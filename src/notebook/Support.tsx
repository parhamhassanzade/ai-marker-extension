import { useState } from 'react';
import { DONATION_URL, FEEDBACK_EMAIL, FEEDBACK_URL } from '../config';
import { support, shouldShowSupport, type SupportState } from '../storage/support';

export function DonationLink({ children }: { children: React.ReactNode }) {
  return (
    <a
      href={DONATION_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Support AI Notebook on Ko-fi (opens in a new tab)"
    >
      {children}
    </a>
  );
}
export function FeedbackLink({ children }: { children: React.ReactNode }) {
  return (
    <a href={FEEDBACK_URL} aria-label={`Email feedback or report a problem to ${FEEDBACK_EMAIL}`}>
      {children}
    </a>
  );
}
export function AboutSupport() {
  return (
    <details className="about-support">
      <summary>About AI Notebook</summary>
      <div className="about-support-content" dir="auto">
        <DonationLink>Support this project ♥</DonationLink>
        <p>
          AI Notebook is free and works locally on your device. If it helps you, you can support its
          development.
        </p>
        <p>
          Feedback or a problem?{' '}
          <FeedbackLink>
            <bdi dir="ltr">{FEEDBACK_EMAIL}</bdi>
          </FeedbackLink>
        </p>
      </div>
    </details>
  );
}
export function MainSupport() {
  return (
    <span className="main-support">
      <DonationLink>Support ♥</DonationLink>
    </span>
  );
}
export function ExportSupport({
  state,
  onChange,
}: {
  state: SupportState;
  onChange(state: SupportState): void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!shouldShowSupport(state)) return null;
  async function dismiss() {
    setSaving(true);
    setError('');
    try {
      onChange(await support.dismiss());
    } catch {
      setError('Could not save this preference. Please try again.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <aside className="export-support" aria-label="Optional project support" dir="auto">
      <p>
        Glad AI Notebook is useful! If you'd like, you can support it on{' '}
        <DonationLink>Ko-fi</DonationLink>.
      </p>
      <button
        type="button"
        className="text-button"
        disabled={saving}
        onClick={() => {
          void dismiss();
        }}
      >
        Don't show again
      </button>
      {error && <p role="status">{error}</p>}
    </aside>
  );
}
