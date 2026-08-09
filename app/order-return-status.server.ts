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

async function hasReturnNumbersSyncedFlag(shop: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ returnOrderNumbersSyncedAt: Date | null }>
    >`
      SELECT "returnOrderNumbersSyncedAt"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    return Boolean(rows[0]?.returnOrderNumbersSyncedAt);
  } catch {
    return false;
  }
}

type OrderGidRow = { orderGid: string };

export type ReturnOrderMeta = {
  orderGid: string;
  convertedAt: Date;
  createdAt: Date;
  documentNumber: string | null;
  sequence: number | null;
};

function hasReturnDelegate() {
  return (
    typeof (prisma as { orderReturnStatus?: unknown })
      .orderReturnStatus === "object"
  );
}

function returnSeriesEntry(entry: NumberSeriesEntry): NumberSeriesEntry {
  return normalizeNumberSeriesEntry(entry, {
    prefix: "RET-",
    startingNumber: "0001",
    suffix: "",
  });
}

/** Public: last allocated return sequence for Settings Transaction numbers. */
export async function getLastReturnAllocatedSequence(
  shop: string,
): Promise<number | null> {
  return getLastReturnSequence(shop);
}

async function getLastReturnSequence(
  shop: string,
): Promise<number | null> {
  const maxRows = await prisma.$queryRaw<Array<{ maxSeq: number | null }>>`
    SELECT MAX(sequence) AS "maxSeq"
    FROM "OrderReturnStatus"
    WHERE shop = ${shop}
  `;
  const max = maxRows[0]?.maxSeq;
  return typeof max === "number" && Number.isFinite(max) ? max : null;
}

async function getMaxReturnDigitWidth(
  shop: string,
  entry: NumberSeriesEntry,
  lastSequence: number | null,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ documentNumber: string | null }>>`
    SELECT "documentNumber"
    FROM "OrderReturnStatus"
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

async function allocateNextReturnNumber(
  shop: string,
  series: NumberSeriesEntry,
): Promise<{ sequence: number; documentNumber: string }> {
  const entry = returnSeriesEntry(series);
  const last = await getLastReturnSequence(shop);
  const sequence = resolveNumberSeriesNextSequence(entry, last);
  const digitWidth = await getMaxReturnDigitWidth(shop, entry, last);
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
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return true;
  }
  return Boolean(
    typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "23505",
  );
}

/** All return order GIDs for this shop (newest first). */
export async function getAllReturnOrderGids(
  shop: string,
): Promise<string[]> {
  try {
    if (hasReturnDelegate()) {
      const rows = await prisma.orderReturnStatus.findMany({
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
      FROM "OrderReturnStatus"
      WHERE shop = ${shop}
      ORDER BY "convertedAt" DESC
    `;
    return rows.map((row) => row.orderGid);
  } catch {
    return [];
  }
}

/** Batch meta for returns (sort / list / numbers). */
export async function getReturnMetaByOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Map<string, ReturnOrderMeta>> {
  const map = new Map<string, ReturnOrderMeta>();
  if (orderGids.length === 0) return map;

  try {
    if (hasReturnDelegate()) {
      const rows = await prisma.orderReturnStatus.findMany({
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
      FROM "OrderReturnStatus"
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
      FROM "OrderReturnStatus"
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

/** Batch lookup: which order GIDs have a return for this shop. */
export async function getReturnOrderGids(
  shop: string,
  orderGids: string[],
): Promise<Set<string>> {
  const marked = new Set<string>();
  if (orderGids.length === 0) return marked;

  if (hasReturnDelegate()) {
    const rows = await prisma.orderReturnStatus.findMany({
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
    FROM "OrderReturnStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  for (const row of rows) marked.add(row.orderGid);
  return marked;
}

/**
 * Ensure every return order has a RET- document number.
 * Allocates missing numbers in convertedAt order (stable backfill).
 * No-op until Settings → Return order sync has run.
 */
export async function ensureReturnDocumentNumbers(
  shop: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  if (orderGids.length === 0) return numbers;

  const meta = await getReturnMetaByOrderGids(shop, orderGids);
  for (const [gid, row] of meta) {
    if (row.documentNumber) numbers.set(gid, row.documentNumber);
  }

  if (!(await hasReturnNumbersSyncedFlag(shop))) {
    return numbers;
  }

  const series = await loadNumberSeriesEntryForShop(shop, "return");
  const missing = orderGids.filter((gid) => {
    const row = meta.get(gid);
    return row && !row.documentNumber;
  });

  missing.sort((a, b) => {
    const aAt = meta.get(a)?.convertedAt?.getTime() ?? 0;
    const bAt = meta.get(b)?.convertedAt?.getTime() ?? 0;
    return aAt - bAt;
  });

  if (missing.length > 0) {
    const entry = returnSeriesEntry(series);
    const last = await getLastReturnSequence(shop);
    const digitWidth = await getMaxReturnDigitWidth(shop, entry, last);
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
            UPDATE "OrderReturnStatus"
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
            FROM "OrderReturnStatus"
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

/** Mark a Shopify order as return; assign RET- only after merchant Sync. */
export async function markOrderReturn(shop: string, orderGid: string) {
  const existing = await prisma.$queryRaw<
    Array<{ documentNumber: string | null }>
  >`
    SELECT "documentNumber"
    FROM "OrderReturnStatus"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;

  if (existing[0]?.documentNumber) {
    await prisma.$executeRaw`
      UPDATE "OrderReturnStatus"
      SET "convertedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop} AND "orderGid" = ${orderGid}
    `;
    return existing[0].documentNumber;
  }

  // Before Settings → Return order sync: keep the order on the Return list
  // without inventing RET- numbers (same pattern as Draft before Draft sync).
  if (!(await hasReturnNumbersSyncedFlag(shop))) {
    if (existing[0]) {
      await prisma.$executeRaw`
        UPDATE "OrderReturnStatus"
        SET "convertedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop} AND "orderGid" = ${orderGid}
      `;
      return "";
    }
    await prisma.$executeRaw`
      INSERT INTO "OrderReturnStatus" (
        id, shop, "orderGid", "convertedAt", sequence, "documentNumber",
        "createdAt", "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        ${orderGid},
        CURRENT_TIMESTAMP,
        NULL,
        NULL,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (shop, "orderGid") DO UPDATE SET
        "convertedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    `;
    return "";
  }

  const series = await loadNumberSeriesEntryForShop(shop, "return");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { sequence, documentNumber } = await allocateNextReturnNumber(
      shop,
      series,
    );
    try {
      if (existing[0]) {
        const updated = await prisma.$executeRaw`
          UPDATE "OrderReturnStatus"
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
          FROM "OrderReturnStatus"
          WHERE shop = ${shop}
            AND "orderGid" = ${orderGid}
          LIMIT 1
        `;
        if (after[0]?.documentNumber) return after[0].documentNumber;
        continue;
      }

      await prisma.$executeRaw`
        INSERT INTO "OrderReturnStatus" (
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
  if (hasReturnDelegate()) {
    await prisma.orderReturnStatus.upsert({
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
    INSERT INTO "OrderReturnStatus" (id, shop, "orderGid", "convertedAt", "createdAt", "updatedAt")
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

/** Remove return marks for the given orders. */
export async function unmarkOrdersReturn(
  shop: string,
  orderGids: string[],
): Promise<number> {
  if (orderGids.length === 0) return 0;

  if (hasReturnDelegate()) {
    const result = await prisma.orderReturnStatus.deleteMany({
      where: { shop, orderGid: { in: orderGids } },
    });
    return result.count;
  }

  const result = await prisma.$executeRaw`
    DELETE FROM "OrderReturnStatus"
    WHERE shop = ${shop}
      AND "orderGid" IN (${Prisma.join(orderGids)})
  `;
  return Number(result);
}
