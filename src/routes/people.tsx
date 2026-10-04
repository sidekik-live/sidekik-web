import { createFileRoute } from "@tanstack/react-router";
import { NativeSelect } from "@/components/NativeSelect";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type Role } from "@/lib/auth";
import { assignRole } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "People | sidekik" },
      { name: "description", content: "Experts and learners in your organisation." },
      { property: "og:title", content: "People | sidekik" },
      { property: "og:description", content: "Experts and learners in your organisation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PeoplePage,
});

function PeoplePage() {
  const { membership } = useAuth();
  const orgId = membership?.orgId;
  const isAdmin = membership?.role === "admin";
  const { data, isLoading, error } = useQuery({
    queryKey: ["people", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [experts, learners] = await Promise.all([
        supabase
          .from("experts")
          .select("id, display_name, language, onet_code, user_id, created_at")
          .eq("org_id", orgId!)
          .order("display_name"),
        supabase
          .from("learners")
          .select("id, display_name, language, user_id, created_at")
          .eq("org_id", orgId!)
          .order("display_name"),
      ]);
      if (experts.error) throw experts.error;
      if (learners.error) throw learners.error;
      return { experts: experts.data, learners: learners.data };
    },
  });

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>
      {isAdmin && orgId && <AssignRoleForm orgId={orgId} />}
      {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="mt-6 text-sm text-destructive">{(error as Error).message}</p>}
      {data && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <PeopleList
            title="Experts"
            rows={data.experts.map((e) => ({ ...e, extra: e.onet_code }))}
          />
          <PeopleList title="Learners" rows={data.learners.map((l) => ({ ...l, extra: null }))} />
        </div>
      )}
    </div>
  );
}

function PeopleList({
  title,
  rows,
}: {
  title: string;
  rows: {
    id: string;
    display_name: string;
    language: string;
    user_id: string | null;
    extra: string | null;
  }[];
}) {
  return (
    <section className="rounded-lg border">
      <h2 className="border-b px-4 py-2 text-sm font-semibold">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </h2>
      <ul className="divide-y text-sm">
        {rows.length === 0 && <li className="px-4 py-3 text-muted-foreground">None yet.</li>}
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between px-4 py-2">
            <span className="font-medium">{r.display_name}</span>
            <span className="text-xs text-muted-foreground">
              {r.language.toUpperCase()}
              {r.extra ? ` · ${r.extra}` : ""}
              {r.user_id ? "" : " · invited"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: "learner", label: "Learner" },
  { value: "expert", label: "Expert" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

// The account must already exist (Supabase > Authentication > Users); this only sets its role.
function AssignRoleForm({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>("learner");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState(false);
  const needsProfile = role === "expert" || role === "learner";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await assignRole({
        org_id: orgId,
        email: email.trim(),
        role,
        ...(needsProfile ? { language } : {}),
        ...(needsProfile && name.trim() ? { display_name: name.trim() } : {}),
      });
      toast.success(`${email.trim()} is now ${role === "admin" ? "an admin" : `a ${role}`}`);
      setEmail("");
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["people", orgId] });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <p className="text-sm text-muted-foreground">
        Give an existing account a role. Accounts are created in Supabase.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <NativeSelect
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          aria-label="Role"
          wrapperClassName="w-36"
          className="h-9 rounded-md border bg-background pl-2 text-sm"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
        <Input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          className="w-56"
        />
        {needsProfile && (
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (optional)"
              aria-label="Name"
              className="w-40"
            />
            <Input
              required
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              placeholder="Lang"
              aria-label="Language"
              className="w-20"
            />
          </>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Assign role"}
        </Button>
      </div>
    </form>
  );
}
