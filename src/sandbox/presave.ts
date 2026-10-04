import { API_URL } from "@/lib/config";
import type { InvoiceState } from "./contract";

export type SandboxMode = "capture" | "tutor";

/** How long Save waits for the rule check before falling back (see presave()). */
export const PRESAVE_TIMEOUT_MS = 3000;

export interface PresaveResult {
  allow: boolean;
  guardrail_id?: string;
  quote?: string;
  step_id?: string;
  /** Not in the gateway response yet; used for highlighting if it gets added. */
  field?: string;
  /** The check couldn't run (timeout, network or server error). */
  unavailable?: true;
}

export interface PresaveContext {
  sid?: string | undefined;
  mode?: SandboxMode | undefined;
  timeoutMs?: number;
  /** Supabase access token for the gateway's JWT auth. */
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

async function supabaseToken(): Promise<string | null> {
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * DESIGN §6: before saving, ask the gateway (→ tutor's deterministic rule check) whether the
 * save is allowed. The design's 300 ms budget only holds on localhost: in production the request
 * crosses the internet to Railway and the gateway looks up the user and session in Supabase, which
 * alone can take longer. PRESAVE_TIMEOUT_MS leaves room for that. If the check can't run, capture
 * allows the save (the expert must never be blocked) and tutor blocks it (a learner must never
 * save past a guardrail).
 * Without a session (MiniERP opened on its own) every save is allowed.
 */
export async function presave(
  state: InvoiceState,
  ctx: PresaveContext = {},
): Promise<PresaveResult> {
  const {
    sid,
    mode = "capture",
    timeoutMs = PRESAVE_TIMEOUT_MS,
    getToken = supabaseToken,
    fetchImpl = fetch,
  } = ctx;
  if (!sid) return { allow: true };

  const fallback: PresaveResult = { allow: mode !== "tutor", unavailable: true };
  const token = await getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${API_URL}/v1/sessions/${encodeURIComponent(sid)}/presave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ state }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as Partial<PresaveResult>;
    if (typeof body.allow !== "boolean") return fallback;
    return body as PresaveResult;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
