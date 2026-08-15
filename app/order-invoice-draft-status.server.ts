import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "./db.server";
import {
  formatNumberSeriesValue,
  normalizeNumberSeriesEntry,
  resolveNumberSeriesNextSequence,
  widenStartingNumberPad,
  type NumberSeriesEntry,
} from "./number-series";
import { loadNumberSeriesEntryForShop, raiseNumberSeriesNextSequence } from "./shop-settings.server";

type OrderGidRow = { orderGid: string };

export type DraftOrderMeta = {
  orderGid: string;
  draftedAt: Date;
  createdAt: Date;
  documentNumber: string | null;
  sequence: number | null;
  customerNote: string | null;
  terms: string | null;
};

function hasDraftDelegate() {
  return (
    typeof (prisma as { orderInvoiceDraftStatus?: unknown })
      .orderInvoiceDraftStatus === "object"
  );
}

function draftSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "DFT-",
    startingNumber: "0001",
    suffix: "",
    entryMode: "auto",
  });
}

async function getLastDraftSequence(shop: string): Promise<number | null> {
  const maxRows = await prisma.$queryRaw<Array<{ maxSeq: number | null }>>`
    SELECT MAX(sequence) AS "maxSeq"
    FROM "OrderInvoiceDraftStatus"
    WHERE shop = ${shop}
  `;
  const max = maxRows[0]?.maxSeq;
  return typeof max === "number" && Number.isFinite(max) ? max : null;
}

/** Public: last allocated draft sequence for Settings Transaction numbers. */
export async function getLastDraftAllocatedSequence(
  shop: string,
): Promise<number | null> {
  return getLastDraftSequence(shop);
}

async function getMaxDraftDigitWidth(
  shop: string,
  entry: NumberSeriesEntry,
  lastSequence: number | null,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ documentNumber: string | null }>>`
    SELECT "documentNumber"
    FROM "OrderInvoiceDraftStatus"
    WHERE shop = ${shop}
      AND "documentNumber" IS NOT NULL
  `;
  let width = Math.max(
    entry.startingNumber.replace(/\D/g, "").length,
    String(lastSequence ?? 0).length,
    1,
  );
  for (const row of rows) {
    if (!row.documentNumber) continue;
    const digits = row.documentNumber.replace(/\D/g, "");
    if (digits.length > width) width = digits.length;
  }
  return width;
}

async function allocateNextDraftNumber(
  shop: string,
  series: NumberSeriesEntry,
): Promise<{ sequence: number; documentNumber: string }> {
  const entry = draftSeriesEntry(series);
  const last = await getLastDraftSequence(shop);
  const sequence = resolveNumberSeriesNextSequence(entry, last);
  const digitWidth = await getMaxDraftDigitWidth(shop, entry, last);
  const paddedEntry = {
    ...entry,
    startingNumber: widenStartingNumberPad(entry.startingNumber, digitWidth),
  };
  return {
    sequence,
    documentNumber: formatNumberSeriesValue(paddedEntry, sequence),
  };
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002") ||
    (typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"),
  );
}

/** All draft-invoice order GIDs for this shop (newest first). */
export async function getAllDraftOrderGids(shop: string): Promise<string[]> {
  try {
    if (hasDraftDelegate()) {
      const rows = await prisma.orderInvoiceDraftStatus.findMany({
        where: { shop },
        select: { orderGid: true },
        orderBy: { draftedAt: "desc" },
      });
      return rows.map((row) => row.orderGid);
    }
  } catch {
    // Fall through to raw SQL.
  }

  try {
    const rows = await prisma.$queryRaw<OrderGidRow[]>`
      SELECT "orderGid"
      FROM "OrderInvoiceDraftStatus"
      WHERE shop = ${shop}
      ORDER BY "draftedAt" DESC
    `;
    return rows.map((row) => row.orderGid);
  } catch {
    return [];
  }
}

/** Batch meta for drafts (sort / list / numbers). */
export async function getDraftMetaByOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Map<string, DraftOrderMeta>> {
  const map = new Map<string, DraftOrderMeta>();
  if (orderGids.length === 0) return map;

  try {
    if (hasDraftDelegate()) {
      const rows = await prisma.orderInvoiceDraftStatus.findMany({
        where: { shop, orderGid: { in: orderGids } },
        select: {
          orderGid: true,
          draftedAt: true,
          createdAt: true,
          documentNumber: true,
          sequence: true,
          customerNote: true,
          terms: true,
        },
      });
      for (const row of rows) {
        map.set(row.orderGid, {
          orderGid: row.orderGid,
          draftedAt: row.draftedAt,
          createdAt: row.createdAt,
          documentNumber: row.documentNumber,
          sequence: row.sequence,
          customerNote: row.customerNote,
          terms: row.terms,
        });
      }
      return map;
    }
  } catch {
    // Fall through.
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        orderGid: string;
        draftedAt: Date;
        createdAt: Date;
        documentNumber: string | null;
        sequence: number | null;
        customerNote: string | null;
        terms: string | null;
      }>
    >`
      SELECT
        "orderGid",
        "draftedAt",
        "createdAt",
        "documentNumber",
        sequence,
        "customerNote",
        terms
      FROM "OrderInvoiceDraftStatus"
      WHERE shop = ${shop}
        AND "orderGid" IN (${Prisma.join(orderGids)})
    `;
    for (const row of rows) {
      map.set(row.orderGid, {
        orderGid: row.orderGid,
        draftedAt: row.draftedAt,
        createdAt: row.createdAt,
        documentNumber: row.documentNumber,
        sequence: row.sequence,
        customerNote: row.customerNote,
        terms: row.terms,
      });
    }
  } catch {
    // ignore
  }
  return map;
}

/** All draft meta for this shop (newest drafted first). */
export async function getAllDraftMeta(
  shop: string,
): Promise<Map<string, DraftOrderMeta>> {
  const map = new Map<string, DraftOrderMeta>();
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        orderGid: string;
        draftedAt: Date;
        createdAt: Date;
        documentNumber: string | null;
        sequence: number | null;
        customerNote: string | null;
        terms: string | null;
      }>
    >`
      SELECT
        "orderGid",
        "draftedAt",
        "createdAt",
        "documentNumber",
        sequence,
        "customerNote",
        terms
      FROM "OrderInvoiceDraftStatus"
      WHERE shop = ${shop}
      ORDER BY "draftedAt" DESC
    `;
    for (const row of rows) {
      map.set(row.orderGid, {
        orderGid: row.orderGid,
        draftedAt: row.draftedAt,
        createdAt: row.createdAt,
        documentNumber: row.documentNumber,
        sequence: row.sequence,
        customerNote: row.customerNote,
        terms: row.terms,
      });
    }
  } catch {
    // ignore
  }
  return map;
}

/** Batch lookup: which order GIDs have a draft for this shop. */
export async function getDraftOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Set<string>> {
  const marked = new Set<string>();
  if (orderGids.length === 0) return marked;

  if (hasDraftDelegate()) {
    try {
      const rows = await prisma.orderInvoiceDraftStatus.findMany({
        where: { shop, orderGid: { in: orderGids } },
        select: { orderGid: true },
      });
      for (const row of rows) marked.add(row.orderGid);
      return marked;
    } catch {
      // Fall through.
    }
  }

  try {
    const rows = await prisma.$queryRaw<OrderGidRow[]>`
      SELECT "orderGid"
      FROM "OrderInvoiceDraftStatus"
      WHERE shop = ${shop}
        AND "orderGid" IN (${Prisma.join(orderGids)})
    `;
    for (const row of rows) marked.add(row.orderGid);
  } catch {
    // ignore
  }
  return marked;
}

/**
 * Ensure every draft order has a DFT- document number.
 * Allocates missing numbers in draftedAt order (stable backfill).
 */
export async function ensureDraftDocumentNumbers(
  shop: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  if (orderGids.length === 0) return numbers;

  const meta = await getDraftMetaByOrderGids(shop, orderGids);
  const missing = orderGids.filter(
    (gid) => !meta.get(gid)?.documentNumber?.trim(),
  );

  for (const [gid, row] of meta) {
    if (row.documentNumber) numbers.set(gid, row.documentNumber);
  }

  missing.sort((a, b) => {
    const aAt = meta.get(a)?.draftedAt?.getTime() ?? 0;
    const bAt = meta.get(b)?.draftedAt?.getTime() ?? 0;
    return aAt - bAt;
  });

  for (const orderGid of missing) {
    try {
      const documentNumber = (await markOrderDraft(shop, orderGid))?.trim();
      if (documentNumber) numbers.set(orderGid, documentNumber);
    } catch (error) {
      console.error("Draft number ensure failed:", orderGid, error);
    }
  }

  return numbers;
}

/** Mark a Shopify order / draft order as a draft invoice and assign DFT- number. */
export async function markOrderDraft(shop: string, orderGid: string) {
  const existing = await prisma.$queryRaw<
    Array<{ documentNumber: string | null }>
  >`
    SELECT "documentNumber"
    FROM "OrderInvoiceDraftStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;

  if (existing[0]?.documentNumber) {
    await prisma.$executeRaw`
      UPDATE "OrderInvoiceDraftStatus"
      SET "draftedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop} AND "orderGid" = ${orderGid}
    `;
    return existing[0].documentNumber;
  }

  const series = await loadNumberSeriesEntryForShop(shop, "draft");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { sequence, documentNumber } = await allocateNextDraftNumber(
      shop,
      series,
    );
    try {
      if (existing[0]) {
        const updated = await prisma.$executeRaw`
          UPDATE "OrderInvoiceDraftStatus"
          SET
            sequence = ${sequence},
            "documentNumber" = COALESCE("documentNumber", ${documentNumber}),
            "draftedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE shop = ${shop}
            AND "orderGid" = ${orderGid}
        `;
        if (Number(updated) > 0) {
          await raiseNumberSeriesNextSequence(shop, "draft", sequence + 1);
          return documentNumber;
        }
        const after = await prisma.$queryRaw<
          Array<{ documentNumber: string | null }>
        >`
          SELECT "documentNumber"
          FROM "OrderInvoiceDraftStatus"
          WHERE shop = ${shop}
            AND "orderGid" = ${orderGid}
          LIMIT 1
        `;
        if (after[0]?.documentNumber) return after[0].documentNumber;
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO "OrderInvoiceDraftStatus" (
          id, shop, "orderGid", "draftedAt", sequence, "documentNumber",
          "createdAt", "updatedAt"
        )
        VALUES (
          ${randomUUID()},
          ${shop},
          ${orderGid},
          CURRENT_TIMESTAMP,
          ${sequence},
          ${documentNumber},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `;
      await raiseNumberSeriesNextSequence(shop, "draft", sequence + 1);
      return documentNumber;
    } catch (error) {
      if (isUniqueConflict(error)) {
        const after = await prisma.$queryRaw<
          Array<{ documentNumber: string | null }>
        >`
          SELECT "documentNumber"
          FROM "OrderInvoiceDraftStatus"
          WHERE shop = ${shop}
            AND "orderGid" = ${orderGid}
          LIMIT 1
        `;
        if (after[0]?.documentNumber) return after[0].documentNumber;
        continue;
      }
      throw error;
    }
  }

  const fallback = await prisma.$queryRaw<
    Array<{ documentNumber: string | null }>
  >`
    SELECT "documentNumber"
    FROM "OrderInvoiceDraftStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;
  if (fallback[0]?.documentNumber) return fallback[0].documentNumber;

  throw new Error(`Failed to assign a draft number for ${orderGid}`);
}

/** Remove draft marks for the given orders. */
export async function unmarkOrdersDraft(
  shop: string,
  orderGids: string[],
): Promise<number> {
  if (orderGids.length === 0) return 0;

  if (hasDraftDelegate()) {
    try {
      const result = await prisma.orderInvoiceDraftStatus.deleteMany({
        where: { shop, orderGid: { in: orderGids } },
      });
      return result.count;
    } catch {
      // Fall through.
    }
  }

  const result = await prisma.$executeRaw`
    DELETE FROM "OrderInvoiceDraftStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  return Number(result);
}

/** Update draft document details (number / date / note / terms). */
export async function updateDraftDocumentDetails(
  shop: string,
  orderGid: string,
  input: {
    documentNumber?: string | null;
    draftedAt?: Date | null;
    customerNote?: string | null;
    terms?: string | null;
  },
): Promise<void> {
  const sets: Prisma.Sql[] = [
    Prisma.sql`"updatedAt" = CURRENT_TIMESTAMP`,
  ];
  if (input.documentNumber !== undefined) {
    sets.push(Prisma.sql`"documentNumber" = ${input.documentNumber}`);
  }
  if (input.draftedAt !== undefined) {
    sets.push(Prisma.sql`"draftedAt" = ${input.draftedAt}`);
  }
  if (input.customerNote !== undefined) {
    sets.push(Prisma.sql`"customerNote" = ${input.customerNote}`);
  }
  if (input.terms !== undefined) {
    sets.push(Prisma.sql`terms = ${input.terms}`);
  }
  await prisma.$executeRaw`
    UPDATE "OrderInvoiceDraftStatus"
    SET ${Prisma.join(sets)}
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
  `;
}
