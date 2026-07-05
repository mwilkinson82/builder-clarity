// The portal "Viewed" trigger (GETTINGPAID2).
//
// The Viewed signal is a trust feature: the cockpit's Sent -> Viewed -> Paid
// chain delays collections on the belief the client has seen the bill, so a
// false positive is worse than no signal. Recording therefore fires ONLY on
// an explicit open — a non-null invoice selection — and NEVER falls back to
// whatever invoice the UI happens to display by default. (The GETTINGPAID1
// bug: the recording derivation reused the display default, so any portal
// visit — daily reports, change orders — stamped the first invoice as
// viewed.)
//
// The pure derivation carries the decision logic so the node smoke can pin
// it; the hook wires it to the effect so the component test and production
// run the identical code path.
import { useEffect, useRef } from "react";

export interface InvoiceViewToRecordInput {
  /** The invoice the user explicitly opened; null = no explicit open. */
  selectedInvoiceId: string | null;
  /** Invoices the portal user can actually see. */
  visibleInvoiceIds: readonly string[];
  /** Ids already recorded this visit (per-visit dedupe). */
  alreadyRecorded: ReadonlySet<string>;
}

// Returns the invoice id to record now, or null. No default, no fallback:
// display defaults must never feed this function.
export function invoiceViewToRecord(input: InvoiceViewToRecordInput): string | null {
  if (!input.selectedInvoiceId) return null;
  if (!input.visibleInvoiceIds.includes(input.selectedInvoiceId)) return null;
  if (input.alreadyRecorded.has(input.selectedInvoiceId)) return null;
  return input.selectedInvoiceId;
}

/**
 * Fires `record` once per explicitly opened invoice per visit. Fire-and-
 * forget: the viewed signal must never break the portal.
 */
export function useInvoiceViewSignal(
  selectedInvoiceId: string | null,
  visibleInvoiceIds: readonly string[],
  record: (invoiceId: string) => Promise<unknown>,
) {
  const recordedRef = useRef<Set<string>>(new Set());
  const invoiceIdToRecord = invoiceViewToRecord({
    selectedInvoiceId,
    visibleInvoiceIds,
    alreadyRecorded: recordedRef.current,
  });
  useEffect(() => {
    if (!invoiceIdToRecord) return;
    recordedRef.current.add(invoiceIdToRecord);
    record(invoiceIdToRecord).catch(() => null);
    // The record fn identity is not a trigger; only an explicit open is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceIdToRecord]);
}
