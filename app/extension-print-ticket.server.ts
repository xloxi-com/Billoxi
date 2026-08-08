import { randomUUID } from "node:crypto";

type PrintTicketRecord = {
  body: Uint8Array;
  contentType: string;
  fileName?: string;
  shop: string;
  expiresAt: number;
};

const TICKET_TTL_MS = 180_000;

type PrintTicketStore = Map<string, PrintTicketRecord>;

/** Survive Vite SSR HMR so prep→iframe race does not lose tickets. */
function ticketStore(): PrintTicketStore {
  const g = globalThis as typeof globalThis & {
    __billoxiPrintTickets?: PrintTicketStore;
  };
  if (!g.__billoxiPrintTickets) {
    g.__billoxiPrintTickets = new Map();
  }
  return g.__billoxiPrintTickets;
}

function pruneExpiredTickets() {
  const tickets = ticketStore();
  const now = Date.now();
  for (const [id, row] of tickets) {
    if (row.expiresAt <= now) tickets.delete(id);
  }
}

/** Store printable bytes for AdminPrintAction iframe (unguessable id + TTL). */
export function createExtensionPrintTicket(args: {
  body: Uint8Array;
  contentType: string;
  fileName?: string;
  shop: string;
}): string {
  pruneExpiredTickets();
  const id = randomUUID().replace(/-/g, "").slice(0, 24);
  ticketStore().set(id, {
    body: args.body,
    contentType: args.contentType,
    fileName: args.fileName,
    shop: args.shop,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return id;
}

export function peekExtensionPrintTicket(ticketId: string): {
  body: Uint8Array;
  contentType: string;
  fileName?: string;
  shop: string;
} | null {
  pruneExpiredTickets();
  const id = String(ticketId || "").trim();
  if (!id) return null;
  const row = ticketStore().get(id);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    ticketStore().delete(id);
    return null;
  }
  return {
    body: row.body,
    contentType: row.contentType,
    fileName: row.fileName,
    shop: row.shop,
  };
}
