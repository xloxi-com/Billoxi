import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "./db.server";
import {
  formatNumberSeriesValue,
  normalizeNumberSeriesEntry,
  resolveNumberSeriesNextSequence,
  type NumberSeriesEntry,
} from "./number-series";
import { loadNumberSeriesEntryForShop } from "./shop-settings.server";

type OrderGidRow = { orderGid: string };
type OrderInvoiceAtRow = { orderGid: string; invoicedAt: Date };
type OrderInvoiceNumberRow = {
  orderGid: string;
  invoicedAt: Date;
  documentNumber: string | null;
  sequence: number | null;
  customerNote: string | null;
  terms: string | null;
};

export type InvoicedOrderMeta = {
  invoicedAt: Date;
  documentNumber: string | null;
  sequence: number | null;
  customerNote: string | null;
  terms: string | null;
};

function hasInvoiceDelegate() {
  return typeof (prisma as { orderInvoiceStatus?: unknown }).orderInvoiceStatus ===
    "object";
}

function invoiceSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "INV-",
    startingNumber: "0001",
    suffix: "",
  });
}

async function getLastInvoiceSequence(shop: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ sequence: number | null }>>`
    SELECT sequence
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND sequence IS NOT NULL
    ORDER BY sequence DESC
    LIMIT 1
  `;
  return rows[0]?.sequence ?? null;
}

async function allocateNextInvoiceNumber(
  shop: string,
  series: NumberSeriesEntry,
): Promise<{ sequence: number; documentNumber: string }> {
  const entry = invoiceSeriesEntry(series);
  const last = await getLastInvoiceSequence(shop);
  const sequence = resolveNumberSeriesNextSequence(entry, last);
  return {
    sequence,
    documentNumber: formatNumberSeriesValue(entry, sequence),
  };
}

/** Batch lookup: which order GIDs are marked invoiced for this shop. */
export async function getInvoicedOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Set<string>> {
  const map = await getInvoicedMetaByOrderGids(shop, orderGids);
  return new Set(map.keys());
}

/** Batch lookup: invoicedAt timestamps for order GIDs. */
export async function getInvoicedAtByOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Map<string, Date>> {
  const meta = await getInvoicedMetaByOrderGids(shop, orderGids);
  const invoiced = new Map<string, Date>();
  for (const [orderGid, value] of meta) {
    invoiced.set(orderGid, value.invoicedAt);
  }
  return invoiced;
}

/** Batch lookup: invoice meta (date + document number) for order GIDs. */
export async function getInvoicedMetaByOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Map<string, InvoicedOrderMeta>> {
  const invoiced = new Map<string, InvoicedOrderMeta>();
  if (orderGids.length === 0) return invoiced;

  // Prefer raw SQL so this works even if the Prisma client is temporarily stale.
  const rows = await prisma.$queryRaw<OrderInvoiceNumberRow[]>`
    SELECT "orderGid", "invoicedAt", "documentNumber", sequence, "customerNote", terms
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  for (const row of rows) {
    invoiced.set(row.orderGid, {
      invoicedAt: row.invoicedAt,
      documentNumber: row.documentNumber,
      sequence: row.sequence,
      customerNote: row.customerNote,
      terms: row.terms,
    });
  }
  return invoiced;
}

/** All order GIDs marked invoiced for this shop. */
export async function getAllInvoicedOrderGids(
  shop: string,
): Promise<string[]> {
  if (hasInvoiceDelegate()) {
    const rows = await prisma.orderInvoiceStatus.findMany({
      where: { shop },
      select: { orderGid: true },
      orderBy: { invoicedAt: "desc" },
    });
    return rows.map((row) => row.orderGid);
  }

  const rows = await prisma.$queryRaw<OrderGidRow[]>`
    SELECT "orderGid"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
    ORDER BY "invoicedAt" DESC
  `;
  return rows.map((row) => row.orderGid);
}

/**
 * Ensure every invoiced order has an INV- document number.
 * Allocates missing numbers in invoicedAt order (stable backfill).
 */
export async function ensureInvoiceDocumentNumbers(
  shop: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  if (orderGids.length === 0) return numbers;

  const meta = await getInvoicedMetaByOrderGids(shop, orderGids);
  const series = await loadNumberSeriesEntryForShop(shop, "invoice");
  const missing = orderGids.filter((gid) => {
    const row = meta.get(gid);
    return row && !row.documentNumber;
  });

  for (const [gid, row] of meta) {
    if (row.documentNumber) numbers.set(gid, row.documentNumber);
  }

  // Stable order for backfill: oldest invoice first.
  missing.sort((a, b) => {
    const aAt = meta.get(a)?.invoicedAt?.getTime() ?? 0;
    const bAt = meta.get(b)?.invoicedAt?.getTime() ?? 0;
    return aAt - bAt;
  });

  for (const orderGid of missing) {
    const assigned = await assignInvoiceNumberToOrder(shop, orderGid, series);
    if (assigned) numbers.set(orderGid, assigned);
  }

  return numbers;
}

async function assignInvoiceNumberToOrder(
  shop: string,
  orderGid: string,
  series: NumberSeriesEntry,
): Promise<string | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { sequence, documentNumber } = await allocateNextInvoiceNumber(
      shop,
      series,
    );

    try {
      const updated = await prisma.$executeRaw`
        UPDATE "OrderInvoiceStatus"
        SET
          sequence = ${sequence},
          "documentNumber" = ${documentNumber},
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop}
          AND "orderGid" = ${orderGid}
          AND "documentNumber" IS NULL
      `;
      if (Number(updated) > 0) return documentNumber;

      const existing = await prisma.$queryRaw<
        Array<{ documentNumber: string | null }>
      >`
        SELECT "documentNumber"
        FROM "OrderInvoiceStatus"
        WHERE shop = ${shop}
          AND "orderGid" = ${orderGid}
        LIMIT 1
      `;
      return existing[0]?.documentNumber ?? null;
    } catch (error) {
      // Unique conflict on sequence/documentNumber — retry with next value.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      // Postgres unique_violation
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "23505"
      ) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

/** Mark a Shopify order as invoiced and assign an INV- document number. */
export async function markOrderInvoiced(shop: string, orderGid: string) {
  const series = await loadNumberSeriesEntryForShop(shop, "invoice");

  const existing = await prisma.$queryRaw<
    Array<{ documentNumber: string | null }>
  >`
    SELECT "documentNumber"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;

  if (existing[0]?.documentNumber) {
    await prisma.$executeRaw`
      UPDATE "OrderInvoiceStatus"
      SET "invoicedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop} AND "orderGid" = ${orderGid}
    `;
    return existing[0].documentNumber;
  }

  if (existing[0]) {
    return (await assignInvoiceNumberToOrder(shop, orderGid, series)) ?? "";
  }

  const { sequence, documentNumber } = await allocateNextInvoiceNumber(
    shop,
    series,
  );
  await prisma.$executeRaw`
    INSERT INTO "OrderInvoiceStatus" (
      id, shop, "orderGid", "invoicedAt", sequence, "documentNumber", "createdAt", "updatedAt"
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
    ON CONFLICT (shop, "orderGid")
    DO UPDATE SET
      "invoicedAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
  `;

  // If conflict row already existed without a number, assign now.
  return (
    (await assignInvoiceNumberToOrder(shop, orderGid, series)) ||
    documentNumber
  );
}

/** Clear invoiced flags (e.g. after fixing false positives from sales-order print). */
export async function clearAllOrderInvoiceStatuses() {
  if (hasInvoiceDelegate()) {
    await prisma.orderInvoiceStatus.deleteMany({});
    return;
  }
  await prisma.$executeRaw`DELETE FROM "OrderInvoiceStatus"`;
}

/** Remove invoice records for the given orders (Shopify order is kept). */
export async function unmarkOrdersInvoiced(shop: string, orderGids: string[]) {
  const gids = orderGids.map((gid) => gid.trim()).filter(Boolean);
  if (gids.length === 0) return 0;

  if (hasInvoiceDelegate()) {
    const result = await prisma.orderInvoiceStatus.deleteMany({
      where: { shop, orderGid: { in: gids } },
    });
    return result.count;
  }

  await prisma.$executeRaw`
    DELETE FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(gids)})
  `;
  return gids.length;
}

export type UpdateInvoiceDetailsInput = {
  documentNumber: string;
  invoicedAt: Date;
  customerNote: string;
  terms: string;
};

/** Update invoice number, date, customer note, and terms for one order. */
export async function updateInvoiceDocumentDetails(
  shop: string,
  orderGid: string,
  input: UpdateInvoiceDetailsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const documentNumber = input.documentNumber.trim();
  const invoicedAt = input.invoicedAt;
  const customerNote = input.customerNote.trim();
  const terms = input.terms.trim();

  if (!documentNumber) {
    return { ok: false, error: "Invoice number is required" };
  }
  if (Number.isNaN(invoicedAt.getTime())) {
    return { ok: false, error: "Invalid invoice date" };
  }

  const existing = await prisma.$queryRaw<Array<{ orderGid: string }>>`
    SELECT "orderGid"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;
  if (!existing[0]) {
    return { ok: false, error: "Invoice not found" };
  }

  const conflict = await prisma.$queryRaw<Array<{ orderGid: string }>>`
    SELECT "orderGid"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "documentNumber" = ${documentNumber}
      AND "orderGid" <> ${orderGid}
    LIMIT 1
  `;
  if (conflict[0]) {
    return {
      ok: false,
      error: `Invoice number ${documentNumber} is already used`,
    };
  }

  try {
    await prisma.$executeRaw`
      UPDATE "OrderInvoiceStatus"
      SET
        "documentNumber" = ${documentNumber},
        "invoicedAt" = ${invoicedAt},
        "customerNote" = ${customerNote || null},
        terms = ${terms || null},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
        AND "orderGid" = ${orderGid}
    `;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update invoice";
    if (/unique|duplicate/i.test(message)) {
      return {
        ok: false,
        error: `Invoice number ${documentNumber} is already used`,
      };
    }
    return { ok: false, error: message };
  }

  return { ok: true };
}
