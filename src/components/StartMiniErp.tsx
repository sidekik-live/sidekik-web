import { MonitorUp } from "lucide-react";

/**
 * Centre of the screen preview while nothing is shared (Capture Room and Tutor Room): the button
 * that opens the MiniERP (and, before the session has started, starts it), with a note that the
 * MiniERP window has to be shared.
 */
export function StartMiniErp({ started, onOpen }: { started: boolean; onOpen: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center text-center">
        <MonitorUp aria-hidden className="size-10 text-primary" />
        <button
          onClick={onOpen}
          className="mt-4 rounded-lg bg-primary px-8 py-3 text-base font-semibold text-primary-foreground shadow-sm hover:opacity-90"
        >
          {started ? "Open MiniERP" : "Open MiniERP & start"}
        </button>
        <p className="mt-4 rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Screen sharing is required.</strong> The MiniERP opens
          in its own window and asks to share it: choose <strong>Allow</strong>. Sidekik only sees
          that window.
        </p>
      </div>
    </div>
  );
}
