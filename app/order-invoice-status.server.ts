import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "./db.server";
import {
  formatNumberSeriesValue,
  normalizeNumberSeriesEntry,
  parseNumberSeriesDigits,
  parseNumberSeriesSequence,
  resolveNumberSeriesNextSequence,
  widenStartingNumberPad,
  type NumberSeriesEntry,
} from "./number-series";
import {
  loadNumberSeriesEntryForShop,
  loadNumberSeriesForShop,
  saveNumberSeriesForShop,
} from "./shop-settings.server";

type OrderGidRow = { orderGid: string };
type OrderInvoiceAtRow = { orderGid: string; invoicedAt: Date };
type OrderInvoiceNumberRow = {
  orderGid: string;
  invoicedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  documentNumber: string | null;
  sequence: number | null;
  customerNote: string | null;
  terms: string | null;
};

export type InvoicedOrderMeta = {
  invoicedAt: Date;
  createdAt: Date;
  updatedAt: Date;
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

async function getLastInvoiceSequence(
  shop: string,
  series?: NumberSeriesEntry,
): Promise<number | null> {
  const entry = series ? invoiceSeriesEntry(series) : null;
  // Prefer indexed MAX(sequence) instead of loading every invoice row.
  const maxRows = await prisma.$queryRaw<Array<{ maxSeq: number | null }>>`
    SELECT MAX(sequence) AS "maxSeq"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
  `;
  let max =
    typeof maxRows[0]?.maxSeq === "number" && Number.isFinite(maxRows[0].maxSeq)
      ? maxRows[0].maxSeq
      : null;

  // Legacy / manual rows may lack sequence — parse only those document numbers.
  if (entry) {
    const orphanRows = await prisma.$queryRaw<
      Array<{ documentNumber: string | null }>
    >`
      SELECT "documentNumber"
      FROM "OrderInvoiceStatus"
      WHERE shop = ${shop}
        AND sequence IS NULL
        AND "documentNumber" IS NOT NULL
    `;
    for (const row of orphanRows) {
      if (!row.documentNumber) continue;
      const parsed = parseNumberSeriesSequence(row.documentNumber, entry);
      if (parsed != null) {
        max = max == null ? parsed : Math.max(max, parsed);
      }
    }
  }
  return max;
}

/** Public: last allocated invoice sequence for Settings next-number preview. */
export async function getLastInvoiceAllocatedSequence(
  shop: string,
): Promise<number | null> {
  const series = invoiceSeriesEntry(
    await loadNumberSeriesEntryForShop(shop, "invoice"),
  );
  return getLastInvoiceSequence(shop, series);
}

async function getMaxInvoiceDigitWidth(
  shop: string,
  entry: NumberSeriesEntry,
  lastSequence?: number | null,
): Promise<number> {
  let width = Math.max(entry.startingNumber.replace(/\D/g, "").length, 1);
  if (typeof lastSequence === "number" && Number.isFinite(lastSequence)) {
    width = Math.max(width, String(Math.floor(lastSequence)).length);
  }
  // Orphan / manual numbers without sequence may use a wider digit pad.
  const orphanRows = await prisma.$queryRaw<
    Array<{ documentNumber: string | null }>
  >`
    SELECT "documentNumber"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND sequence IS NULL
      AND "documentNumber" IS NOT NULL
  `;
  for (const row of orphanRows) {
    if (!row.documentNumber) continue;
    const parsed = parseNumberSeriesDigits(row.documentNumber, entry);
    if (parsed) width = Math.max(width, parsed.digitWidth);
  }
  return width;
}

async function allocateNextInvoiceNumber(
  shop: string,
  series: NumberSeriesEntry,
): Promise<{ sequence: number; documentNumber: string }> {
  const entry = invoiceSeriesEntry(series);
  const last = await getLastInvoiceSequence(shop, entry);
  const digitWidth = await getMaxInvoiceDigitWidth(shop, entry, last);
  const sequence = resolveNumberSeriesNextSequence(entry, last);
  const paddedEntry = {
    ...entry,
    startingNumber: widenStartingNumberPad(entry.startingNumber, digitWidth),
  };
  return {
    sequence,
    documentNumber: formatNumberSeriesValue(paddedEntry, sequence),
  };
}

/** Next invoice number that would be assigned (does not write). */
export async function peekNextInvoiceDocumentNumber(
  shop: string,
): Promise<string> {
  const series = await loadNumberSeriesEntryForShop(shop, "invoice");
  const { documentNumber } = await allocateNextInvoiceNumber(shop, series);
  return documentNumber;
}

/** Max digit width used by existing invoice numbers (for Settings preview pad). */
export async function getInvoiceNumberDigitWidth(
  shop: string,
): Promise<number> {
  const series = invoiceSeriesEntry(
    await loadNumberSeriesEntryForShop(shop, "invoice"),
  );
  const last = await getLastInvoiceSequence(shop, series);
  return getMaxInvoiceDigitWidth(shop, series, last);
}

/** Batch lookup: which order GIDs are marked invoiced for this shop. */
export async function getInvoicedOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Set<string>> {
  const marked = new Set<string>();
  if (orderGids.length === 0) return marked;

  const rows = await prisma.$queryRaw<OrderGidRow[]>`
    SELECT "orderGid"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  for (const row of rows) marked.add(row.orderGid);
  return marked;
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
    SELECT "orderGid", "invoicedAt", "createdAt", "updatedAt", "documentNumber", sequence, "customerNote", terms
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  for (const row of rows) {
    invoiced.set(row.orderGid, {
      invoicedAt: row.invoicedAt,
      createdAt: row.createdAt ?? row.invoicedAt,
      updatedAt: row.updatedAt ?? row.invoicedAt,
      documentNumber: row.documentNumber,
      sequence: row.sequence,
      customerNote: row.customerNote,
      terms: row.terms,
    });
  }
  return invoiced;
}

/** All order GIDs marked invoiced for this shop (newest created first). */
export async function getAllInvoicedOrderGids(
  shop: string,
): Promise<string[]> {
  if (hasInvoiceDelegate()) {
    const rows = await prisma.orderInvoiceStatus.findMany({
      where: { shop },
      select: { orderGid: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => row.orderGid);
  }

  const rows = await prisma.$queryRaw<OrderGidRow[]>`
    SELECT "orderGid"
    FROM "OrderInvoiceStatus"
    WHERE shop = ${shop}
    ORDER BY "createdAt" DESC
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

  // Resolve next sequence once, then assign locally — avoids N full-table scans.
  if (missing.length > 0) {
    const entry = invoiceSeriesEntry(series);
    const last = await getLastInvoiceSequence(shop, entry);
    const digitWidth = await getMaxInvoiceDigitWidth(shop, entry, last);
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
            UPDATE "OrderInvoiceStatus"
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
            FROM "OrderInvoiceStatus"
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
    const series = invoiceSeriesEntry(
      await loadNumberSeriesEntryForShop(shop, "invoice"),
    );
    const parsed = parseNumberSeriesDigits(documentNumber, series);
    const sequence = parsed?.sequence ?? null;

    // Clear sequence on any other row that already owns this number, so the
    // unique (shop, sequence) constraint allows reassigning after a manual edit.
    if (sequence != null) {
      await prisma.$executeRaw`
        UPDATE "OrderInvoiceStatus"
        SET sequence = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop}
          AND sequence = ${sequence}
          AND "orderGid" <> ${orderGid}
      `;
    }

    await prisma.$executeRaw`
      UPDATE "OrderInvoiceStatus"
      SET
        "documentNumber" = ${documentNumber},
        sequence = ${sequence},
        "invoicedAt" = ${invoicedAt},
        "customerNote" = ${customerNote || null},
        terms = ${terms || null},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
        AND "orderGid" = ${orderGid}
    `;

    // Keep auto-generate continuing after this number (INV-000100 → next INV-000101).
    if (parsed) {
      const allSeries = await loadNumberSeriesForShop(shop);
      const current = allSeries.invoice;
      const widened = widenStartingNumberPad(
        current.startingNumber,
        parsed.digitWidth,
      );
      if (widened !== current.startingNumber) {
        await saveNumberSeriesForShop(shop, {
          ...allSeries,
          invoice: {
            ...current,
            startingNumber: widened,
          },
        });
      }
    }
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
