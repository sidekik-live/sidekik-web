import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import seed from "@/sandbox/invoices.json";
import { domEvent, emitDomEvent, emitFrameHint, wireValue } from "@/sandbox/domEvents";
import { toInvoiceState, type SandboxInvoice } from "@/sandbox/invoiceState";
import { presave, type SandboxMode } from "@/sandbox/presave";

export const Route = createFileRoute("/sandbox/erp")({
  // Opened by the Capture/Tutor Room as /sandbox/erp?sid=<session>&mode=capture|tutor.
  // Without sid it's a standalone sandbox: every save is allowed.
  validateSearch: (search: Record<string, unknown>): { sid?: string; mode?: SandboxMode } => ({
    ...(typeof search["sid"] === "string" ? { sid: search["sid"] } : {}),
    ...(search["mode"] === "capture" || search["mode"] === "tutor" ? { mode: search["mode"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "MiniERP — Accounts Payable | Sidekik" },
      {
        name: "description",
        content: "Sandbox accounts-payable screen for practicing invoice coding.",
      },
      { property: "og:title", content: "MiniERP — Accounts Payable | Sidekik" },
      {
        property: "og:description",
        content: "Sandbox accounts-payable screen for practicing invoice coding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ErpPage,
});

type Invoice = SandboxInvoice;
type Field = keyof Invoice;

// Tutor cases (4510, 4511) are never shown in capture; the tutor only practises on them.
const visibleIn = (mode: SandboxMode | undefined) => (inv: Invoice) =>
  mode === "capture" ? !inv.tutor_case : mode === "tutor" ? inv.tutor_case : true;

const clone = (mode: SandboxMode | undefined): Invoice[] =>
  (JSON.parse(JSON.stringify(seed)) as Invoice[]).filter(visibleIn(mode));

function ErpPage() {
  const { sid, mode } = Route.useSearch();
  const [invoices, setInvoices] = useState<Invoice[]>(() => clone(mode));
  const [selectedId, setSelectedId] = useState(invoices[0]!.invoice_id);
  const [draft, setDraft] = useState<Invoice>(invoices[0]!);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const rec = (id: string) => ({ kind: "invoice" as const, id });

  const openRecord = (inv: Invoice) => {
    setSelectedId(inv.invoice_id);
    setDraft({ ...inv });
    setBanner(null);
    setNotice(null);
    setHighlight(null);
    emitDomEvent(
      domEvent("record_open", { record: rec(inv.invoice_id), state: toInvoiceState(inv) }),
    );
  };

  useEffect(() => {
    emitDomEvent(
      domEvent("record_open", { record: rec(draft.invoice_id), state: toInvoiceState(draft) }),
    );
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "highlight_field" && typeof d.field === "string") {
        setHighlight(d.field);
        document.getElementById(`f-${d.field}`)?.focus();
      } else if (d.type === "reset_case") {
        const fresh = clone(mode);
        setInvoices(fresh);
        const cur = fresh.find((i) => i.invoice_id === draftRef.current.invoice_id) ?? fresh[0]!;
        setSelectedId(cur.invoice_id);
        setDraft({ ...cur });
        setBanner(null);
        setNotice(null);
        setHighlight(null);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = <K extends Field>(field: K, value: Invoice[K]) => {
    const before = draft[field];
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (highlight === field) setHighlight(null);
    emitDomEvent(
      domEvent("field_change", {
        record: rec(draft.invoice_id),
        field,
        before: wireValue(before),
        after: wireValue(value),
        state: toInvoiceState(next),
      }),
    );
  };

  const focus = (field: Field) =>
    emitDomEvent(
      domEvent("field_focus", {
        record: rec(draft.invoice_id),
        field,
        state: toInvoiceState(draft),
      }),
    );
  // Blur isn't a DomEvent kind; it only asks the room for an extra screen frame.
  const blur = (_field: Field) => emitFrameHint("blur");

  const commit = (next: Invoice) => {
    setInvoices((list) => list.map((i) => (i.invoice_id === next.invoice_id ? next : i)));
    setDraft(next);
  };

  const save = async () => {
    if (checking) return;
    const state = draft;
    const invoiceState = toInvoiceState(state);
    emitDomEvent(domEvent("save_attempt", { record: rec(state.invoice_id), state: invoiceState }));
    setBanner(null);
    setNotice(null);
    setChecking(true);
    const res = await presave(invoiceState, { sid, mode }).finally(() => setChecking(false));
    if (!res.allow) {
      setBanner(
        res.unavailable
          ? "Couldn't check this invoice against the rules. Try saving again."
          : (res.quote ?? "Save blocked by guardrail."),
      );
      // The tutor's `intervene` command also highlights the field via the room.
      setHighlight(res.field ?? null);
      return;
    }
    const next = { ...state, status: state.status === "on hold" ? "on hold" : "posted" };
    commit(next);
    setNotice(
      `Invoice ${next.invoice_id} saved.${res.unavailable ? " (Rule check unavailable.)" : ""}`,
    );
    emitFrameHint("save");
  };

  const hold = () => change("status", "on hold");
  const secondApproval = () => change("approvals_count", draft.approvals_count + 1);

  const cls = (f: string) =>
    `h-7 w-full border bg-background px-1.5 text-xs outline-none focus:border-ring ${
      highlight === f
        ? "border-destructive ring-2 ring-destructive/40 bg-destructive/5"
        : "border-input"
    }`;
  const bind = (f: Field) => ({
    id: `f-${f}`,
    onFocus: () => focus(f),
    onBlur: () => blur(f),
    className: cls(f),
  });

  return (
    <div className="flex h-screen flex-col text-xs">
      <div className="flex h-9 items-center justify-between border-b border-border bg-muted px-3">
        <span className="font-semibold">MiniERP · Accounts Payable · Invoice Verification</span>
        <span className="text-muted-foreground">Sandbox</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[480px] shrink-0 overflow-auto border-r border-border">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left">
                {["Inv", "Supplier", "CoCd", "Date", "Net", "CC", "Status"].map((h) => (
                  <th key={h} className="border-b border-border px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.invoice_id}
                  onClick={() => openRecord(inv)}
                  className={`cursor-pointer border-b border-border ${
                    inv.invoice_id === selectedId ? "bg-accent font-medium" : "hover:bg-muted/60"
                  }`}
                >
                  <td className="px-2 py-1 font-mono">{inv.invoice_id}</td>
                  <td className="truncate px-2 py-1 max-w-[140px]">{inv.supplier}</td>
                  <td className="px-2 py-1">{inv.company_code}</td>
                  <td className="px-2 py-1">{inv.invoice_date}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    {inv.net_amount.toLocaleString("de-DE")}
                  </td>
                  <td className="px-2 py-1 font-mono">{inv.cost_center}</td>
                  <td className="px-2 py-1">{inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {banner && (
            <div
              role="alert"
              className="mb-3 border border-destructive bg-destructive px-3 py-2 text-destructive-foreground"
            >
              <strong>Save blocked.</strong> “{banner}”
            </div>
          )}
          {notice && <div className="mb-3 border border-border bg-muted px-3 py-2">{notice}</div>}

          <fieldset className="border border-border p-3">
            <legend className="px-1 font-semibold">
              Invoice {draft.invoice_id} — {draft.description}
            </legend>
            <div className="grid grid-cols-[140px_1fr_140px_1fr] items-center gap-x-3 gap-y-2">
              <L>Invoice ID</L>
              <input
                {...bind("invoice_id")}
                value={draft.invoice_id}
                readOnly
                className={`${cls("invoice_id")} bg-muted`}
              />
              <L>Status</L>
              <select
                {...bind("status")}
                value={draft.status}
                onChange={(e) => change("status", e.target.value)}
              >
                <option value="open">open</option>
                <option value="on hold">on hold</option>
                <option value="posted">posted</option>
              </select>

              <L>Supplier</L>
              <input
                {...bind("supplier")}
                value={draft.supplier}
                onChange={(e) => change("supplier", e.target.value)}
              />
              <L>Supplier known</L>
              <input
                id="f-supplier_known"
                type="checkbox"
                checked={draft.supplier_known}
                onFocus={() => focus("supplier_known")}
                onBlur={() => blur("supplier_known")}
                onChange={(e) => change("supplier_known", e.target.checked)}
                className={`size-4 justify-self-start ${highlight === "supplier_known" ? "ring-2 ring-destructive" : ""}`}
              />

              <L>Company code</L>
              <select
                {...bind("company_code")}
                value={draft.company_code}
                onChange={(e) => change("company_code", e.target.value)}
              >
                <option>DE01</option>
                <option>CZ01</option>
              </select>
              <L>Invoice date</L>
              <input
                {...bind("invoice_date")}
                type="date"
                value={draft.invoice_date}
                onChange={(e) => change("invoice_date", e.target.value)}
              />

              <L>Net amount</L>
              <input
                {...bind("net_amount")}
                type="number"
                value={draft.net_amount}
                onChange={(e) => change("net_amount", Number(e.target.value))}
              />
              <L>Currency</L>
              <select
                {...bind("currency")}
                value={draft.currency}
                onChange={(e) => change("currency", e.target.value)}
              >
                <option>EUR</option>
                <option>CZK</option>
                <option>USD</option>
              </select>

              <L>Category</L>
              <select
                {...bind("category")}
                value={draft.category}
                onChange={(e) => change("category", e.target.value)}
              >
                <option value="equipment">equipment</option>
                <option value="services">services</option>
                <option value="parts">parts</option>
                <option value="office">office</option>
              </select>
              <L>Cost center</L>
              <select
                {...bind("cost_center")}
                value={draft.cost_center}
                onChange={(e) => change("cost_center", e.target.value)}
              >
                <option value="4711">4711 Opex</option>
                <option value="0400">0400 Capex</option>
                <option value="0410">0410 Capex-IT</option>
              </select>

              <L>Asset number</L>
              <input
                {...bind("asset_number")}
                value={draft.asset_number}
                onChange={(e) => change("asset_number", e.target.value)}
              />
              <L>Approvals</L>
              <div className="flex items-center gap-2">
                <input
                  {...bind("approvals_count")}
                  value={draft.approvals_count}
                  readOnly
                  className={`${cls("approvals_count")} w-12 bg-muted`}
                />
                <Btn onClick={secondApproval}>Send for 2nd approval</Btn>
              </div>
            </div>
          </fieldset>

          <div className="mt-3 flex justify-end gap-2">
            <Btn onClick={hold}>Hold</Btn>
            <Btn primary onClick={save} disabled={checking}>
              {checking ? "Checking…" : "Save"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label className="text-right text-muted-foreground">{children}</label>;
}

function Btn({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-7 shrink-0 whitespace-nowrap border px-3 py-1 text-xs leading-tight disabled:opacity-60 ${
        primary
          ? "border-primary bg-primary text-primary-foreground hover:opacity-90"
          : "border-input bg-secondary hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
