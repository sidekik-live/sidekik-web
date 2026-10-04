import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { NativeSelect } from "@/components/NativeSelect";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { createSession, type SessionKind } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Home | sidekik" },
      {
        name: "description",
        content:
          "Your Sidekik home: start a capture, start practice, or see your organisation at a glance.",
      },
      { property: "og:title", content: "Home | sidekik" },
      {
        property: "og:description",
        content:
          "Your Sidekik home: start a capture, start practice, or see your organisation at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

function Home() {
  const { membership } = useAuth();
  if (!membership) return null;
  if (membership.role === "admin" || membership.role === "manager") {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <AdminDashboard orgId={membership.orgId} />
      </div>
    );
  }
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      {membership.role === "expert" ? (
        <StartCard
          orgId={membership.orgId}
          kind="capture"
          title="Start capture"
          {...CAPTURE_INTRO}
        />
      ) : (
        <StartCard
          orgId={membership.orgId}
          kind="tutor"
          title="Start practice"
          {...PRACTICE_INTRO}
        />
      )}
    </div>
  );
}

// What each role does, spelled out for demo visitors.
const CAPTURE_INTRO = {
  intro:
    "You're the expert. Do a real task in the MiniERP while sharing your screen, and Sidekik learns how you do it, including the judgment calls that aren't written down anywhere.",
  steps: [
    "Start, agree to recording and allow your microphone. Sidekik says hello, then mostly listens.",
    "Click Open MiniERP and Share screen, then work through a few invoices as you normally would.",
    "After a meaningful change, pause for a few seconds: Sidekik asks a short “why” question. Answer in your own words.",
    "Click Task done. Sidekik reviews the session, asks a few follow-up questions, then reads back what it learned for you to confirm.",
  ],
  tip: "The result is a Work Map: your steps, decisions and reasons, which new hires then practise against.",
};

const PRACTICE_INTRO = {
  intro:
    "You're the new hire. Work through the same task with Sidekik as your coach, guided by the expert's own words.",
  steps: [
    "Start, agree and allow your microphone. Then click Open MiniERP and Share screen.",
    "Work through the invoices. At key steps Sidekik asks what you'd do and why: answer out loud or type in the box.",
    "About to save a mistake? Sidekik stops it before it goes through, explains the expert's rule and can replay their moment.",
    "Click End practice for a summary of what you did on your own and what to practise next.",
  ],
  tip: "Try invoice #4510, the €7,200 equipment invoice, to see a mistake caught before it's saved.",
};

const TABLES = [
  { table: "workflows", label: "Workflows" },
  { table: "sessions", label: "Sessions" },
  { table: "work_maps", label: "Work maps" },
] as const;

function AdminDashboard({ orgId }: { orgId: string }) {
  const { data } = useQuery({
    queryKey: ["dashboard-counts", orgId],
    queryFn: async () => {
      const [workflows, sessions, workMaps] = await Promise.all([
        supabase.from("workflows").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        supabase.from("sessions").select("id", { count: "exact", head: true }).eq("org_id", orgId),
        supabase.from("work_maps").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      ]);
      return [workflows.count ?? 0, sessions.count ?? 0, workMaps.count ?? 0];
    },
  });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {TABLES.map((t, i) => (
          <div key={t.table} className="rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">{t.label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{data ? data[i] : "–"}</p>
          </div>
        ))}
      </div>
    </>
  );
}

function StartCard({
  orgId,
  kind,
  title,
  intro,
  steps,
  tip,
}: {
  orgId: string;
  kind: SessionKind;
  title: string;
  intro: string;
  steps: string[];
  tip: string;
}) {
  const navigate = useNavigate();
  const [workflowId, setWorkflowId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: workflows = [] } = useQuery({
    queryKey: ["workflows", orgId],
    queryFn: async () => {
      const { data } = await supabase
        .from("workflows")
        .select("id, name")
        .eq("org_id", orgId)
        .order("name");
      return data ?? [];
    },
  });
  const selected = workflowId || workflows[0]?.id || "";

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      const { session_id } = await createSession({ workflow_id: selected, kind });
      navigate({
        to: kind === "capture" ? "/capture/$sid" : "/tutor/$sid",
        params: { sid: session_id },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-base text-muted-foreground">{intro}</p>

      <h2 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        How it works
      </h2>
      <ol className="mt-3 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 rounded-md bg-accent px-4 py-3 text-sm text-accent-foreground">{tip}</p>

      <label className="mt-6 block text-xs font-medium text-muted-foreground">Workflow</label>
      <NativeSelect
        value={selected}
        onChange={(e) => setWorkflowId(e.target.value)}
        wrapperClassName="mt-1"
        className="h-10 rounded-md border border-input bg-background pl-3 text-sm"
      >
        {workflows.length === 0 && <option value="">No workflows yet</option>}
        {workflows.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </NativeSelect>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        onClick={start}
        disabled={!selected || busy}
        className="mt-5 h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Starting…" : title}
      </button>
    </div>
  );
}
