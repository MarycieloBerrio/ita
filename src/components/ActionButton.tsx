import type { ReactNode } from 'react';
import { useOperation } from '../lib/useOperation';
export function ActionButton({
  action,
  payload,
  children,
  onSuccess,
  className = 'button',
  disabled = false,
  confirm,
}: {
  action: string;
  payload: object;
  children: ReactNode;
  onSuccess?: (result: Record<string, unknown>) => void;
  className?: string;
  disabled?: boolean;
  confirm?: string;
}) {
  const { run, pending, error } = useOperation();
  const execute = async () => {
    if (pending || (confirm && !window.confirm(confirm))) return;
    const result = await run<Record<string, unknown>>(action, payload);
    if (result) onSuccess?.(result);
  };
  return (
    <div className="action-control">
      <button
        type="button"
        className={className}
        disabled={disabled || pending || !navigator.onLine}
        onClick={() => void execute()}
      >
        {pending ? 'Confirmando…' : children}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
