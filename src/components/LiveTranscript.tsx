import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "@/session/engine";

/** How close to the bottom (px) still counts as "following" the conversation. */
const FOLLOW_SLACK_PX = 48;

/**
 * What the person and the agent said, newest last (Capture Room and Tutor Room). Scrolls to each new
 * line while the reader is at the bottom; leaves them alone if they scrolled up to read.
 */
export function LiveTranscript({
  transcript,
  className = "",
}: {
  transcript: TranscriptEntry[];
  className?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const following = useRef(true);
  const last = transcript.at(-1);

  useEffect(() => {
    const list = listRef.current;
    if (list && following.current) list.scrollTop = list.scrollHeight;
  }, [transcript.length, last?.text]);

  const onScroll = () => {
    const list = listRef.current;
    if (list)
      following.current = list.scrollHeight - list.scrollTop - list.clientHeight < FOLLOW_SLACK_PX;
  };

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Live transcript
      </h2>
      <ul ref={listRef} onScroll={onScroll} className="flex-1 space-y-2 overflow-auto">
        {transcript.length === 0 && <li className="text-sm text-muted-foreground">Nothing yet.</li>}
        {transcript.map((t) => (
          <li
            key={t.id}
            className={`rounded-md p-2 text-sm ${t.role === "agent" ? "bg-secondary" : "border border-border"}`}
          >
            <span className="block text-[11px] font-medium text-muted-foreground">
              {t.role === "agent" ? "Sidekik" : "You"}
            </span>
            {t.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
