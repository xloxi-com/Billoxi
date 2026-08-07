import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "./db.server";
import {
  formatNumberSeriesValue,
  normalizeNumberSeriesEntry,
  parseNumberSeriesDigits,
  resolveNumberSeriesNextSequence,
  widenStartingNumberPad,
  type NumberSeriesEntry,
} from "./number-series";
import { loadNumberSeriesEntryForShop } from "./shop-settings.server";
import { getInvoicedMetaByOrderGids } from "./order-invoice-status.server";

type OrderGidRow = { orderGid: string };

export type CreditNoteOrderMeta = {
  convertedAt: Date;
  createdAt: Date;
  documentNumber: string | null;
  sequence: number | null;
  reason: string | null;
  customerNote: string | null;
  terms: string | null;
  voidedAt: Date | null;
};

export type MarkCreditNoteInput = {
  reason?: string;
  customerNote?: string;
  terms?: string;
};

export type UpdateCreditNoteDetailsInput = {
  documentNumber: string;
  convertedAt: Date;
  reason: string;
  customerNote: string;
  terms: string;
};

function hasCreditNoteDelegate() {
  return (
    typeof (prisma as { orderCreditNoteStatus?: unknown })
      .orderCreditNoteStatus === "object"
  );
}

function creditNoteSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "CN-",
    startingNumber: "0001",
    suffix: "",
  });
}

async function getLastCreditNoteSequence(shop: string): Promise<number | null> {
  const maxRows = await prisma.$queryRaw<Array<{ maxSeq: number | null }>>`
    SELECT MAX(sequence) AS "maxSeq"
    FROM "OrderCreditNoteStatus"
    WHERE shop = ${shop}
  `;
  const max = maxRows[0]?.maxSeq;
  return typeof max === "number" && Number.isFinite(max) ? max : null;
}

async function allocateNextCreditNoteNumber(
  shop: string,
  series: NumberSeriesEntry,
): Promise<{ sequence: number; documentNumber: string }> {
  const entry = creditNoteSeriesEntry(series);
  const last = await getLastCreditNoteSequence(shop);
  const sequence = resolveNumberSeriesNextSequence(entry, last);
  const digitWidth = Math.max(
    entry.startingNumber.replace(/\D/g, "").length,
    String(sequence).length,
    1,
  );
  const paddedEntry = {
    ...entry,
    startingNumber: widenStartingNumberPad(entry.startingNumber, digitWidth),
  };
  return {
    sequence,
    documentNumber: formatNumberSeriesValue(paddedEntry, sequence),
  };
}

/** Batch lookup: which order GIDs have a credit note for this shop. */
export async function getCreditNoteOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Set<string>> {
  const marked = new Set<string>();
  if (orderGids.length === 0) return marked;

  try {
    const rows = await prisma.$queryRaw<OrderGidRow[]>`
      SELECT "orderGid"
      FROM "OrderCreditNoteStatus"
      WHERE shop = ${shop}
        AND "orderGid" IN (${Prisma.join(orderGids)})
    `;
    for (const row of rows) marked.add(row.orderGid);
  } catch {
    // Table missing until migrate.
  }
  return marked;
}

/** All credit-note order GIDs for this shop (newest first). */
export async function getAllCreditNoteOrderGids(
  shop: string,
): Promise<string[]> {
  try {
    if (hasCreditNoteDelegate()) {
      const rows = await prisma.orderCreditNoteStatus.findMany({
        where: { shop },
        select: { orderGid: true },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => row.orderGid);
    }
  } catch {
    // Fall through to raw SQL.
  }

  try {
    const rows = await prisma.$queryRaw<OrderGidRow[]>`
      SELECT "orderGid"
      FROM "OrderCreditNoteStatus"
      WHERE shop = ${shop}
      ORDER BY "createdAt" DESC
    `;
    return rows.map((row) => row.orderGid);
  } catch {
    return [];
  }
}

/** Batch lookup: credit note meta for order GIDs. */
export async function getCreditNoteMetaByOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Map<string, CreditNoteOrderMeta>> {
  const marked = new Map<string, CreditNoteOrderMeta>();
  if (orderGids.length === 0) return marked;

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        orderGid: string;
        convertedAt: Date;
        createdAt: Date;
        documentNumber: string | null;
        sequence: number | null;
        reason: string | null;
        customerNote: string | null;
        terms: string | null;
        voidedAt: Date | null;
      }>
    >`
      SELECT
        "orderGid",
        "convertedAt",
        "createdAt",
        "documentNumber",
        sequence,
        reason,
        "customerNote",
        terms,
        "voidedAt"
      FROM "OrderCreditNoteStatus"
      WHERE shop = ${shop}
        AND "orderGid" IN (${Prisma.join(orderGids)})
    `;
    for (const row of rows) {
      marked.set(row.orderGid, {
        convertedAt: row.convertedAt,
        createdAt: row.createdAt ?? row.convertedAt,
        documentNumber: row.documentNumber,
        sequence: row.sequence,
        reason: row.reason ?? null,
        customerNote: row.customerNote ?? null,
        terms: row.terms ?? null,
        voidedAt: row.voidedAt ?? null,
      });
    }
  } catch {
    // Older schema without new columns — fall back to core fields.
    try {
      const rows = await prisma.$queryRaw<
        Array<{
          orderGid: string;
          convertedAt: Date;
          createdAt: Date;
          documentNumber: string | null;
          sequence: number | null;
        }>
      >`
        SELECT "orderGid", "convertedAt", "createdAt", "documentNumber", sequence
        FROM "OrderCreditNoteStatus"
        WHERE shop = ${shop}
          AND "orderGid" IN (${Prisma.join(orderGids)})
      `;
      for (const row of rows) {
        marked.set(row.orderGid, {
          convertedAt: row.convertedAt,
          createdAt: row.createdAt ?? row.convertedAt,
          documentNumber: row.documentNumber,
          sequence: row.sequence,
          reason: null,
          customerNote: null,
          terms: null,
          voidedAt: null,
        });
      }
    } catch {
      // Table missing until migrate.
    }
  }
  return marked;
}

/**
 * Ensure every credit-note row has a CN- document number.
 * Allocates missing numbers in convertedAt order (stable backfill).
 */
export async function ensureCreditNoteDocumentNumbers(
  shop: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  if (orderGids.length === 0) return numbers;

  const meta = await getCreditNoteMetaByOrderGids(shop, orderGids);
  const series = await loadNumberSeriesEntryForShop(shop, "credit-note");
  const missing = orderGids.filter((gid) => {
    const row = meta.get(gid);
    return row && !row.documentNumber;
  });

  for (const [gid, row] of meta) {
    if (row.documentNumber) numbers.set(gid, row.documentNumber);
  }

  missing.sort((a, b) => {
    const aAt = meta.get(a)?.convertedAt?.getTime() ?? 0;
    const bAt = meta.get(b)?.convertedAt?.getTime() ?? 0;
    return aAt - bAt;
  });

  if (missing.length > 0) {
    const entry = creditNoteSeriesEntry(series);
    const last = await getLastCreditNoteSequence(shop);
    const digitWidth = Math.max(
      entry.startingNumber.replace(/\D/g, "").length,
      last != null ? String(last).length : 1,
      1,
    );
    let nextSequence = resolveNumberSeriesNextSequence(entry, last);
    const paddedEntry = {
      ...entry,
      startingNumber: widenStartingNumberPad(entry.startingNumber, digitWidth),
    };

    for (const orderGid of missing) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const sequence = nextSequence;
        const documentNumber = formatNumberSeriesValue(paddedEntry, sequence);
        try {
          const updated = await prisma.$executeRaw`
            UPDATE "OrderCreditNoteStatus"
            SET
              sequence = ${sequence},
              "documentNumber" = ${documentNumber},
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE shop = ${shop}
              AND "orderGid" = ${orderGid}
              AND "documentNumber" IS NULL
          `;
          if (Number(updated) > 0) {
            numbers.set(orderGid, documentNumber);
            nextSequence += 1;
            break;
          }

          const existing = await prisma.$queryRaw<
            Array<{ documentNumber: string | null }>
          >`
            SELECT "documentNumber"
            FROM "OrderCreditNoteStatus"
            WHERE shop = ${shop}
              AND "orderGid" = ${orderGid}
            LIMIT 1
          `;
          if (existing[0]?.documentNumber) {
            numbers.set(orderGid, existing[0].documentNumber);
          }
          break;
        } catch (error) {
          const isUnique =
            (error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002") ||
            (typeof error === "object" &&
              error &&
              "code" in error &&
              (error as { code?: string }).code === "23505");
          if (isUnique) {
            nextSequence += 1;
            continue;
          }
          throw error;
        }
      }
    }
  }

  return numbers;
}

/** Mark a Shopify order / invoice as credit-note created (idempotent). */
export async function markOrderCreditNote(
  shop: string,
  orderGid: string,
  input: MarkCreditNoteInput = {},
) {
  const invoiced = await getInvoicedMetaByOrderGids(shop, [orderGid]);
  if (!invoiced.has(orderGid)) {
    throw new Error("Create an invoice for this order before a credit note");
  }

  const series = await loadNumberSeriesEntryForShop(shop, "credit-note");
  const reason = input.reason?.trim() || null;
  const customerNote = input.customerNote?.trim() || null;
  const terms = input.terms?.trim() || null;

  try {
    const existing = await prisma.$queryRaw<
      Array<{ documentNumber: string | null; voidedAt: Date | null }>
    >`
      SELECT "documentNumber", "voidedAt"
      FROM "OrderCreditNoteStatus"
      WHERE shop = ${shop}
        AND "orderGid" = ${orderGid}
      LIMIT 1
    `;

    if (existing[0]?.documentNumber && !existing[0].voidedAt) {
      await prisma.$executeRaw`
        UPDATE "OrderCreditNoteStatus"
        SET
          "convertedAt" = CURRENT_TIMESTAMP,
          reason = COALESCE(${reason}, reason),
          "customerNote" = COALESCE(${customerNote}, "customerNote"),
          terms = COALESCE(${terms}, terms),
          "creditAmount" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop} AND "orderGid" = ${orderGid}
      `;
      return existing[0].documentNumber;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { sequence, documentNumber } = await allocateNextCreditNoteNumber(
        shop,
        series,
      );
      try {
        if (existing[0]) {
          const updated = await prisma.$executeRaw`
            UPDATE "OrderCreditNoteStatus"
            SET
              sequence = ${sequence},
              "documentNumber" = COALESCE("documentNumber", ${documentNumber}),
              "convertedAt" = CURRENT_TIMESTAMP,
              reason = ${reason},
              "customerNote" = ${customerNote},
              terms = ${terms},
              "creditAmount" = NULL,
              "voidedAt" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE shop = ${shop}
              AND "orderGid" = ${orderGid}
          `;
          if (Number(updated) > 0) {
            return existing[0].documentNumber || documentNumber;
          }
          continue;
        }

        await prisma.$executeRaw`
          INSERT INTO "OrderCreditNoteStatus" (
            id, shop, "orderGid", "convertedAt", sequence, "documentNumber",
            reason, "customerNote", terms, "creditAmount",
            "createdAt", "updatedAt"
          )
          VALUES (
            ${randomUUID()},
            ${shop},
            ${orderGid},
            CURRENT_TIMESTAMP,
            ${sequence},
            ${documentNumber},
            ${reason},
            ${customerNote},
            ${terms},
            NULL,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `;
        return documentNumber;
      } catch (error) {
        const isUnique =
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") ||
          (typeof error === "object" &&
            error &&
            "code" in error &&
            (error as { code?: string }).code === "23505");
        if (isUnique) continue;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("invoice")) {
      throw error;
    }
    // Last-resort insert without extended columns if schema lagging.
    try {
      await prisma.$executeRaw`
        INSERT INTO "OrderCreditNoteStatus" (id, shop, "orderGid", "convertedAt", "createdAt", "updatedAt")
        VALUES (
          ${randomUUID()},
          ${shop},
          ${orderGid},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (shop, "orderGid")
        DO UPDATE SET
          "convertedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      `;
    } catch {
      throw error;
    }
  }

  return "";
}

/** Update credit note number, date, reason, notes, and terms. */
export async function updateCreditNoteDocumentDetails(
  shop: string,
  orderGid: string,
  input: UpdateCreditNoteDetailsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const documentNumber = input.documentNumber.trim();
  const convertedAt = input.convertedAt;
  const reason = input.reason.trim();
  const customerNote = input.customerNote.trim();
  const terms = input.terms.trim();

  if (!documentNumber) {
    return { ok: false, error: "Credit note number is required" };
  }
  if (Number.isNaN(convertedAt.getTime())) {
    return { ok: false, error: "Invalid credit note date" };
  }

  const existing = await prisma.$queryRaw<Array<{ orderGid: string }>>`
    SELECT "orderGid"
    FROM "OrderCreditNoteStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;
  if (!existing[0]) {
    return { ok: false, error: "Credit note not found" };
  }

  const conflict = await prisma.$queryRaw<Array<{ orderGid: string }>>`
    SELECT "orderGid"
    FROM "OrderCreditNoteStatus"
    WHERE shop = ${shop}
      AND "documentNumber" = ${documentNumber}
      AND "orderGid" <> ${orderGid}
    LIMIT 1
  `;
  if (conflict[0]) {
    return {
      ok: false,
      error: `Credit note number ${documentNumber} is already used`,
    };
  }

  try {
    const series = creditNoteSeriesEntry(
      await loadNumberSeriesEntryForShop(shop, "credit-note"),
    );
    const parsed = parseNumberSeriesDigits(documentNumber, series);
    const sequence = parsed?.sequence ?? null;

    if (sequence != null) {
      await prisma.$executeRaw`
        UPDATE "OrderCreditNoteStatus"
        SET sequence = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop}
          AND sequence = ${sequence}
          AND "orderGid" <> ${orderGid}
      `;
    }

    await prisma.$executeRaw`
      UPDATE "OrderCreditNoteStatus"
      SET
        "documentNumber" = ${documentNumber},
        sequence = ${sequence},
        "convertedAt" = ${convertedAt},
        reason = ${reason || null},
        "customerNote" = ${customerNote || null},
        terms = ${terms || null},
        "creditAmount" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
        AND "orderGid" = ${orderGid}
    `;
    return { ok: true };
  } catch (error) {
    const isUnique =
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002") ||
      (typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505");
    if (isUnique) {
      return {
        ok: false,
        error: `Credit note number ${documentNumber} is already used`,
      };
    }
    throw error;
  }
}

/** Soft-void credit notes (keeps history; list can filter). */
export async function voidOrdersCreditNote(shop: string, orderGids: string[]) {
  const gids = orderGids.map((gid) => gid.trim()).filter(Boolean);
  if (gids.length === 0) return 0;

  await prisma.$executeRaw`
    UPDATE "OrderCreditNoteStatus"
    SET "voidedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(gids)})
      AND "voidedAt" IS NULL
  `;
  return gids.length;
}

/** Remove credit note records for the given orders. */
export async function unmarkOrdersCreditNote(
  shop: string,
  orderGids: string[],
) {
  const gids = orderGids.map((gid) => gid.trim()).filter(Boolean);
  if (gids.length === 0) return 0;

  try {
    if (hasCreditNoteDelegate()) {
      const result = await prisma.orderCreditNoteStatus.deleteMany({
        where: { shop, orderGid: { in: gids } },
      });
      return result.count;
    }
  } catch {
    // Fall through.
  }

  await prisma.$executeRaw`
    DELETE FROM "OrderCreditNoteStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(gids)})
  `;
  return gids.length;
}
