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
import { loadNumberSeriesEntryForShop } from "./shop-settings.server";

type OrderGidRow = { orderGid: string };

export type PackingSlipOrderMeta = {
  orderGid: string;
  convertedAt: Date;
  createdAt: Date;
  documentNumber: string | null;
  sequence: number | null;
};

function hasPackingSlipDelegate() {
  return (
    typeof (prisma as { orderPackingSlipStatus?: unknown })
      .orderPackingSlipStatus === "object"
  );
}

function packingSlipSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "PS-",
    startingNumber: "0001",
    suffix: "",
  });
}

async function getLastPackingSlipSequence(
  shop: string,
): Promise<number | null> {
  const maxRows = await prisma.$queryRaw<Array<{ maxSeq: number | null }>>`
    SELECT MAX(sequence) AS "maxSeq"
    FROM "OrderPackingSlipStatus"
    WHERE shop = ${shop}
  `;
  const max = maxRows[0]?.maxSeq;
  return typeof max === "number" && Number.isFinite(max) ? max : null;
}

async function getMaxPackingSlipDigitWidth(
  shop: string,
  entry: NumberSeriesEntry,
  lastSequence: number | null,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ documentNumber: string | null }>>`
    SELECT "documentNumber"
    FROM "OrderPackingSlipStatus"
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

async function allocateNextPackingSlipNumber(
  shop: string,
  series: NumberSeriesEntry,
): Promise<{ sequence: number; documentNumber: string }> {
  const entry = packingSlipSeriesEntry(series);
  const last = await getLastPackingSlipSequence(shop);
  const sequence = resolveNumberSeriesNextSequence(entry, last);
  const digitWidth = await getMaxPackingSlipDigitWidth(shop, entry, last);
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
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002") ||
    (typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "23505")
  );
}

/** All packing-slip order GIDs for this shop (newest first). */
export async function getAllPackingSlipOrderGids(
  shop: string,
): Promise<string[]> {
  try {
    if (hasPackingSlipDelegate()) {
      const rows = await prisma.orderPackingSlipStatus.findMany({
        where: { shop },
        select: { orderGid: true },
        orderBy: { convertedAt: "desc" },
      });
      return rows.map((row) => row.orderGid);
    }
  } catch {
    // Fall through to raw SQL.
  }

  try {
    const rows = await prisma.$queryRaw<OrderGidRow[]>`
      SELECT "orderGid"
      FROM "OrderPackingSlipStatus"
      WHERE shop = ${shop}
      ORDER BY "convertedAt" DESC
    `;
    return rows.map((row) => row.orderGid);
  } catch {
    return [];
  }
}

/** Batch meta for packing slips (sort / list / numbers). */
export async function getPackingSlipMetaByOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Map<string, PackingSlipOrderMeta>> {
  const map = new Map<string, PackingSlipOrderMeta>();
  if (orderGids.length === 0) return map;

  try {
    if (hasPackingSlipDelegate()) {
      const rows = await prisma.orderPackingSlipStatus.findMany({
        where: { shop, orderGid: { in: orderGids } },
        select: {
          orderGid: true,
          convertedAt: true,
          createdAt: true,
          documentNumber: true,
          sequence: true,
        },
      });
      for (const row of rows) {
        map.set(row.orderGid, {
          orderGid: row.orderGid,
          convertedAt: row.convertedAt,
          createdAt: row.createdAt,
          documentNumber: row.documentNumber,
          sequence: row.sequence,
        });
      }
      return map;
    }
  } catch {
    // Fall through — older clients may lack number columns.
  }

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
      FROM "OrderPackingSlipStatus"
      WHERE shop = ${shop}
        AND "orderGid" IN (${Prisma.join(orderGids)})
    `;
    for (const row of rows) {
      map.set(row.orderGid, {
        orderGid: row.orderGid,
        convertedAt: row.convertedAt,
        createdAt: row.createdAt,
        documentNumber: row.documentNumber,
        sequence: row.sequence,
      });
    }
    return map;
  } catch {
    // Schema without documentNumber yet.
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ orderGid: string; convertedAt: Date; createdAt: Date }>
    >`
      SELECT "orderGid", "convertedAt", "createdAt"
      FROM "OrderPackingSlipStatus"
      WHERE shop = ${shop}
        AND "orderGid" IN (${Prisma.join(orderGids)})
    `;
    for (const row of rows) {
      map.set(row.orderGid, {
        orderGid: row.orderGid,
        convertedAt: row.convertedAt,
        createdAt: row.createdAt,
        documentNumber: null,
        sequence: null,
      });
    }
  } catch {
    // ignore
  }
  return map;
}

/** Batch lookup: which order GIDs have a packing slip for this shop. */
export async function getPackingSlipOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Set<string>> {
  const marked = new Set<string>();
  if (orderGids.length === 0) return marked;

  if (hasPackingSlipDelegate()) {
    const rows = await prisma.orderPackingSlipStatus.findMany({
      where: {
        shop,
        orderGid: { in: orderGids },
      },
      select: { orderGid: true },
    });
    for (const row of rows) marked.add(row.orderGid);
    return marked;
  }

  const rows = await prisma.$queryRaw<OrderGidRow[]>`
    SELECT "orderGid"
    FROM "OrderPackingSlipStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  for (const row of rows) marked.add(row.orderGid);
  return marked;
}

/**
 * Ensure every packing-slip order has a PS- document number.
 * Allocates missing numbers in convertedAt order (stable backfill).
 */
export async function ensurePackingSlipDocumentNumbers(
  shop: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  if (orderGids.length === 0) return numbers;

  const meta = await getPackingSlipMetaByOrderGids(shop, orderGids);
  const series = await loadNumberSeriesEntryForShop(shop, "packing-slip");
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
    const entry = packingSlipSeriesEntry(series);
    const last = await getLastPackingSlipSequence(shop);
    const digitWidth = await getMaxPackingSlipDigitWidth(shop, entry, last);
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
            UPDATE "OrderPackingSlipStatus"
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
            FROM "OrderPackingSlipStatus"
            WHERE shop = ${shop}
              AND "orderGid" = ${orderGid}
            LIMIT 1
          `;
          if (existing[0]?.documentNumber) {
            numbers.set(orderGid, existing[0].documentNumber);
          }
          break;
        } catch (error) {
          if (isUniqueConflict(error)) {
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

/** Mark a Shopify order as packing-slip converted and assign PS- number. */
export async function markOrderPackingSlip(shop: string, orderGid: string) {
  const series = await loadNumberSeriesEntryForShop(shop, "packing-slip");

  const existing = await prisma.$queryRaw<
    Array<{ documentNumber: string | null }>
  >`
    SELECT "documentNumber"
    FROM "OrderPackingSlipStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;

  if (existing[0]?.documentNumber) {
    await prisma.$executeRaw`
      UPDATE "OrderPackingSlipStatus"
      SET "convertedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop} AND "orderGid" = ${orderGid}
    `;
    return existing[0].documentNumber;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { sequence, documentNumber } = await allocateNextPackingSlipNumber(
      shop,
      series,
    );
    try {
      if (existing[0]) {
        const updated = await prisma.$executeRaw`
          UPDATE "OrderPackingSlipStatus"
          SET
            sequence = ${sequence},
            "documentNumber" = COALESCE("documentNumber", ${documentNumber}),
            "convertedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE shop = ${shop}
            AND "orderGid" = ${orderGid}
        `;
        if (Number(updated) > 0) {
          return documentNumber;
        }
        const after = await prisma.$queryRaw<
          Array<{ documentNumber: string | null }>
        >`
          SELECT "documentNumber"
          FROM "OrderPackingSlipStatus"
          WHERE shop = ${shop}
            AND "orderGid" = ${orderGid}
          LIMIT 1
        `;
        if (after[0]?.documentNumber) return after[0].documentNumber;
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO "OrderPackingSlipStatus" (
          id, shop, "orderGid", "convertedAt", sequence, "documentNumber",
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
      return documentNumber;
    } catch (error) {
      if (isUniqueConflict(error)) continue;
      throw error;
    }
  }

  // Fallback if number columns are missing on older DBs.
  if (hasPackingSlipDelegate()) {
    await prisma.orderPackingSlipStatus.upsert({
      where: {
        shop_orderGid: { shop, orderGid },
      },
      create: {
        shop,
        orderGid,
        convertedAt: new Date(),
      },
      update: {
        convertedAt: new Date(),
      },
    });
    return "";
  }

  await prisma.$executeRaw`
    INSERT INTO "OrderPackingSlipStatus" (id, shop, "orderGid", "convertedAt", "createdAt", "updatedAt")
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
  return "";
}

/** Remove packing-slip marks for the given orders. */
export async function unmarkOrdersPackingSlip(
  shop: string,
  orderGids: string[],
): Promise<number> {
  if (orderGids.length === 0) return 0;

  if (hasPackingSlipDelegate()) {
    const result = await prisma.orderPackingSlipStatus.deleteMany({
      where: { shop, orderGid: { in: orderGids } },
    });
    return result.count;
  }

  const result = await prisma.$executeRaw`
    DELETE FROM "OrderPackingSlipStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  return Number(result);
}
