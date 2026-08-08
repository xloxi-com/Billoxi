import { randomUUID } from "node:crypto";

type DocumentKind = "sales-order" | "invoice" | "credit-note" | "packing-slip";

/** Opaque export JSON — same shape as /app/sales-order/export. */
export type ExtensionExportPayload = {
  ok: true;
  order: Record<string, unknown> & {
    documentNumber?: string;
    name: string;
  };
  templateId: string;
  settings: Record<string, unknown>;
  storeDetails: Record<string, unknown>;
};

type TicketRecord = {
  payload: ExtensionExportPayload;
  documentKind: DocumentKind;
  shop: string;
  expiresAt: number;
};

const TICKET_TTL_MS = 180_000;
const tickets = new Map<string, TicketRecord>();

function pruneExpiredTickets() {
  const now = Date.now();
  for (const [id, row] of tickets) {
    if (row.expiresAt <= now) tickets.delete(id);
  }
}

/** Store export payload so the download tab skips GraphQL/export. */
export function createExtensionDownloadTicket(args: {
  payload: ExtensionExportPayload;
  documentKind: DocumentKind;
  shop: string;
}): string {
  pruneExpiredTickets();
  const id = randomUUID().replace(/-/g, "").slice(0, 24);
  tickets.set(id, {
    payload: args.payload,
    documentKind: args.documentKind,
    shop: args.shop,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return id;
}

/**
 * Read ticket without consuming it (tab can retry; unguessable id + TTL).
 */
export function peekExtensionDownloadTicket(ticketId: string): {
  payload: ExtensionExportPayload;
  documentKind: DocumentKind;
  shop: string;
} | null {
  pruneExpiredTickets();
  const id = String(ticketId || "").trim();
  if (!id) return null;
  const row = tickets.get(id);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    tickets.delete(id);
    return null;
  }
  return {
    payload: row.payload,
    documentKind: row.documentKind,
    shop: row.shop,
  };
}

/** @deprecated use peekExtensionDownloadTicket */
export function takeExtensionDownloadTicket(
  ticketId: string,
  shop: string,
): { payload: ExtensionExportPayload; documentKind: DocumentKind } | null {
  const row = peekExtensionDownloadTicket(ticketId);
  if (!row) return null;
  if (row.shop !== shop) return null;
  return { payload: row.payload, documentKind: row.documentKind };
}
