import { useState } from "react";

export const CONSENT_VERSION = "v1";

export interface ConsentItem {
  key: string;
  label: string;
}

/**
 * Shown over a room before anything starts: no microphone, voice agent or screen capture until every
 * box is ticked and "I agree" is pressed (Capture Room and Tutor Room).
 */
export function ConsentModal({
  subtitle,
  items,
  onAccept,
}: {
  subtitle: string;
  items: ConsentItem[];
  onAccept: () => void;
}) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const all = items.every((i) => ticked[i.key]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg"
      >
        <h2 className="text-lg font-semibold">Before we start</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-4 space-y-3">
          {items.map((i) => (
            <label key={i.key} className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={!!ticked[i.key]}
                onChange={(e) => setTicked({ ...ticked, [i.key]: e.target.checked })}
              />
              {i.label}
            </label>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Consent text {CONSENT_VERSION}</span>
          <button
            disabled={!all}
            onClick={onAccept}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            I agree
          </button>
        </div>
      </div>
    </div>
  );
}
