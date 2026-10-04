import { describe, expect, it } from "vitest";
import seed from "./invoices.json";
import { toInvoiceState, type SandboxInvoice } from "./invoiceState";

const invoice = (id: string) => (seed as SandboxInvoice[]).find((i) => i.invoice_id === id)!;

describe("toInvoiceState", () => {
  it("normalizes the €7,200 tutor case so G1 and G3 can fire", () => {
    expect(toInvoiceState(invoice("4510"))).toEqual({
      invoice_id: "4510",
      supplier: "Northern Drive Systems",
      supplier_known: false,
      net_amount: 7200,
      currency: "EUR",
      invoice_date: "2026-09-25",
      invoice_month: 9,
      company_code: "DE01",
      category: "equipment",
      cost_center: "4711",
      approvals_count: 1,
    });
  });

  it("derives invoice_month 12 for the December Crane Builders invoices (G4)", () => {
    expect(toInvoiceState(invoice("4480")).invoice_month).toBe(12);
    expect(toInvoiceState(invoice("4511")).invoice_month).toBe(12);
  });

  it("leaves out an empty asset number (G2) and keeps a filled one", () => {
    expect(toInvoiceState(invoice("4471"))).not.toHaveProperty("asset_number");
    expect(toInvoiceState({ ...invoice("4471"), asset_number: " A-1001 " }).asset_number).toBe(
      "A-1001",
    );
  });

  it("only carries the JSON-Logic variables, never UI fields", () => {
    const state = toInvoiceState(invoice("4471"));
    expect(state).not.toHaveProperty("description");
    expect(state).not.toHaveProperty("status");
    expect(state).not.toHaveProperty("tutor_case");
  });
});
