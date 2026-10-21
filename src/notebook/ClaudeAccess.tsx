import { useCallback, useEffect, useState } from 'react';
import { extension } from '../browser/api';
import { CLAUDE_ORIGINS } from '../platforms';

export function useClaudeAccess() {
  const [granted, setGranted] = useState<boolean>();
  const check = useCallback(async () => {
    try {
      setGranted(await extension.permissions.contains({ origins: CLAUDE_ORIGINS }));
    } catch {
      setGranted(undefined); // Browsers without the permissions API (possibly Orion).
    }
  }, []);
  useEffect(() => {
    void check();
    const changed = () => void check();
    extension.permissions?.onAdded?.addListener(changed);
    extension.permissions?.onRemoved?.addListener(changed);
    return () => {
      extension.permissions?.onAdded?.removeListener(changed);
      extension.permissions?.onRemoved?.removeListener(changed);
    };
  }, [check]);
  // Must run directly in the click handler: browsers require a user gesture.
  const request = async () => {
    const result = await extension.permissions.request({ origins: CLAUDE_ORIGINS });
    setGranted(result);
    return result;
  };
  return { granted, request };
}
export function ClaudeAccess({
  request,
  onGranted,
  compact = false,
}: {
  request(): Promise<boolean>;
  onGranted(): void;
  compact?: boolean;
}) {
  const [status, setStatus] = useState('');
  return (
    <div className={compact ? 'claude-access compact' : 'claude-access'}>
      {!compact && (
        <p>
          Use AI Notebook on Claude too. It reads only the claude.ai conversations you open, and
          everything stays on this device.
        </p>
      )}
      <button
        className="text-button"
        onClick={() => {
          setStatus('');
          request().then(
            (granted) => {
              if (granted) onGranted();
              else setStatus('Claude access was not allowed.');
            },
            () => setStatus('This browser could not grant access to claude.ai.'),
          );
        }}
      >
        Allow claude.ai
      </button>
      {status && <p role="status">{status}</p>}
    </div>
  );
}
