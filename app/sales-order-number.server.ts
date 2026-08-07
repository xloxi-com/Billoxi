import prisma from "./db.server";
import { randomUUID } from "node:crypto";
import { getInvoicedOrderGids } from "./order-invoice-status.server";
import {
  parseNumberSeriesDigits,
  widenStartingNumberPad,
  numberingFromSeries,
} from "./number-series";
import {
  loadNumberSeriesEntryForShop,
  loadNumberSeriesForShop,
  saveNumberSeriesEntryMode,
  saveNumberSeriesForShop,
} from "./shop-settings.server";

type NumberingSettings = {
  prefix: string;
  suffix?: string;
  startingNumber: string;
};

export function numberingMeta(numbering: NumberingSettings) {
  const padLength = Math.max(numbering.startingNumber.length, 1);
  const startAt = Number.parseInt(numbering.startingNumber, 10);
  return {
    prefix: numbering.prefix,
    suffix: numbering.suffix ?? "",
    padLength,
    startAt: Number.isFinite(startAt) && startAt >= 0 ? startAt : 1,
  };
}

export function formatSequenceNumber(
  numbering: NumberingSettings,
  sequence: number,
) {
  const { prefix, suffix, padLength } = numberingMeta(numbering);
  return `${prefix}${String(Math.max(0, sequence)).padStart(padLength, "0")}${suffix}`;
}

export async function getLastAllocatedSequence(
  shop: string,
  templateId?: string | null,
): Promise<number | null> {
  const last = await prisma.salesOrderDocumentNumber.findFirst({
    // Shop-wide by default: Active template can change, but the SO series is one.
    where: templateId ? { shop, templateId } : { shop },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return last?.sequence ?? null;
}

/** Batch lookup of already-assigned sales order numbers (does not allocate). */
export async function getSalesOrderDocumentNumbersByOrderGids(
  shop: string,
  templateId: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (orderGids.length === 0) return map;

  // Numbers are scoped by templateId in the DB, but Active template can change
  // after assignment. Prefer the current template, then fall back to any
  // existing number for the same Shopify order so the list never shows "—".
  const rows = await prisma.salesOrderDocumentNumber.findMany({
    where: {
      shop,
      orderGid: { in: orderGids },
    },
    select: {
      orderGid: true,
      documentNumber: true,
      templateId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byOrder = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byOrder.get(row.orderGid);
    if (list) list.push(row);
    else byOrder.set(row.orderGid, [row]);
  }

  for (const orderGid of orderGids) {
    const matches = byOrder.get(orderGid);
    if (!matches || matches.length === 0) continue;
    const preferred =
      matches.find((row) => row.templateId === templateId) ?? matches[0];
    if (preferred?.documentNumber) {
      map.set(orderGid, preferred.documentNumber);
    }
  }
  return map;
}

/**
 * Ensure visible orders have a sales-order number (allocate missing).
 * Reuses a number already issued under another template for the same order.
 * Safe to call in background — never throw to the caller path.
 */
export async function ensureSalesOrderDocumentNumbers(
  shop: string,
  templateId: string,
  orderGids: string[],
): Promise<Map<string, string>> {
  const map = await getSalesOrderDocumentNumbersByOrderGids(
    shop,
    templateId,
    orderGids,
  );
  const missing = orderGids.filter((gid) => !map.get(gid)?.trim());
  if (missing.length === 0) return map;

  const series = await loadNumberSeriesEntryForShop(shop, "sales-order");
  if (series.entryMode === "manual") return map;

  const numbering = numberingFromSeries(series);
  for (const orderGid of missing) {
    try {
      const documentNumber = await allocateSalesOrderDocumentNumber(
        shop,
        templateId,
        orderGid,
        numbering,
      );
      map.set(orderGid, documentNumber);
    } catch (error) {
      console.error(
        "[sales-order-number] Failed to allocate",
        shop,
        orderGid,
        error,
      );
    }
  }
  return map;
}

export async function getNextSequence(
  shop: string,
  templateId: string,
  numbering: NumberingSettings,
): Promise<number> {
  const { startAt } = numberingMeta(numbering);
  const [last, counter] = await Promise.all([
    getLastAllocatedSequence(shop),
    prisma.salesOrderNumberCounter.findUnique({
      where: { shop_templateId: { shop, templateId } },
      select: { nextValue: true },
    }),
  ]);
  const fromLast = last == null ? startAt : last + 1;
  const fromCounter = counter?.nextValue ?? startAt;
  return Math.max(startAt, fromLast, fromCounter);
}

/**
 * Validates a new starting number against already-issued sequences.
 * Unchanged starting numbers are allowed (series origin). Changing to a used
 * or lower value is rejected so existing numbers are never overridden.
 */
export async function validateStartingNumber(
  shop: string,
  templateId: string,
  numbering: NumberingSettings,
  previousNumbering?: NumberingSettings | null,
): Promise<string | null> {
  const { startAt } = numberingMeta(numbering);
  const previousStart = previousNumbering
    ? numberingMeta(previousNumbering).startAt
    : null;

  // Same starting number as before — counter continues; no override.
  if (previousStart != null && previousStart === startAt) {
    return null;
  }

  const last = await getLastAllocatedSequence(shop);
  if (last != null && startAt <= last) {
    return `Cannot set starting number to ${formatSequenceNumber(numbering, startAt)}. Numbers up to ${formatSequenceNumber(numbering, last)} are already used. Enter ${formatSequenceNumber(numbering, last + 1)} or higher.`;
  }

  return null;
}

/** Keep the counter in sync when the merchant raises the starting / next number. */
export async function syncNumberCounter(
  shop: string,
  templateId: string,
  numbering: NumberingSettings,
  nextSequence?: number | null,
) {
  const { prefix, padLength, startAt } = numberingMeta(numbering);
  const last = await getLastAllocatedSequence(shop);
  const minNext = last == null ? startAt : last + 1;
  const requested =
    typeof nextSequence === "number" && Number.isFinite(nextSequence)
      ? Math.max(minNext, Math.floor(nextSequence))
      : null;

  const counter = await prisma.salesOrderNumberCounter.findUnique({
    where: { shop_templateId: { shop, templateId } },
  });

  if (!counter) {
    await prisma.salesOrderNumberCounter.create({
      data: {
        shop,
        templateId,
        nextValue: requested ?? startAt,
        prefix,
        padLength,
      },
    });
    return;
  }

  const updates: {
    nextValue?: number;
    prefix?: string;
    padLength?: number;
  } = {};
  if (requested != null) {
    updates.nextValue = requested;
  } else if (startAt > counter.nextValue) {
    updates.nextValue = startAt;
  }
  if (counter.prefix !== prefix) updates.prefix = prefix;
  if (counter.padLength !== padLength) updates.padLength = padLength;
  if (Object.keys(updates).length === 0) return;

  await prisma.salesOrderNumberCounter.update({
    where: { id: counter.id },
    data: updates,
  });
}

/**
 * Returns a stable sales-order document number for this Shopify order.
 * First open allocates the next sequence from the template starting number.
 * Existing assignments are never overridden — including numbers issued under a
 * previous Active template for the same order.
 */
export async function allocateSalesOrderDocumentNumber(
  shop: string,
  templateId: string,
  orderGid: string,
  numbering: NumberingSettings,
): Promise<string> {
  const existing = await prisma.salesOrderDocumentNumber.findUnique({
    where: {
      shop_templateId_orderGid: {
        shop,
        templateId,
        orderGid,
      },
    },
  });
  if (existing) return existing.documentNumber;

  // Active template may have changed after the number was first assigned.
  // Reuse that number — do not insert a duplicate row (sequence unique can break).
  const prior = await prisma.salesOrderDocumentNumber.findFirst({
    where: { shop, orderGid },
    orderBy: { createdAt: "asc" },
    select: { documentNumber: true },
  });
  if (prior?.documentNumber) return prior.documentNumber;

  const { prefix, suffix, padLength, startAt } = numberingMeta(numbering);

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const assigned = await tx.salesOrderDocumentNumber.findUnique({
          where: {
            shop_templateId_orderGid: {
              shop,
              templateId,
              orderGid,
            },
          },
        });
        if (assigned) return assigned.documentNumber;

        const priorInTx = await tx.salesOrderDocumentNumber.findFirst({
          where: { shop, orderGid },
          orderBy: { createdAt: "asc" },
          select: { documentNumber: true },
        });
        if (priorInTx?.documentNumber) return priorInTx.documentNumber;

        // Shop-wide high-water mark so switching Active template never restarts
        // the series or collides with numbers issued under another template.
        const shopLast = await tx.salesOrderDocumentNumber.findFirst({
          where: { shop },
          orderBy: { sequence: "desc" },
          select: { sequence: true },
        });
        const minNext = Math.max(
          startAt,
          (shopLast?.sequence ?? startAt - 1) + 1,
        );

        let counter = await tx.salesOrderNumberCounter.findUnique({
          where: {
            shop_templateId: {
              shop,
              templateId,
            },
          },
        });

        if (!counter) {
          counter = await tx.salesOrderNumberCounter.create({
            data: {
              shop,
              templateId,
              nextValue: minNext,
              prefix,
              padLength,
            },
          });
        } else {
          const updates: {
            nextValue?: number;
            prefix?: string;
            padLength?: number;
          } = {};
          // Never move the counter backwards — only raise it when needed.
          if (minNext > counter.nextValue) {
            updates.nextValue = minNext;
          }
          if (counter.prefix !== prefix) updates.prefix = prefix;
          if (counter.padLength !== padLength) updates.padLength = padLength;
          if (Object.keys(updates).length > 0) {
            counter = await tx.salesOrderNumberCounter.update({
              where: { id: counter.id },
              data: updates,
            });
          }
        }

        // Skip any sequence that somehow already exists (collision / legacy data).
        let sequence = counter.nextValue;
        for (let skip = 0; skip < 50; skip++) {
          const taken = await tx.salesOrderDocumentNumber.findFirst({
            where: {
              shop,
              sequence,
            },
            select: { id: true },
          });
          if (!taken) break;
          sequence += 1;
        }

        const documentNumber = `${prefix}${String(sequence).padStart(padLength, "0")}${suffix}`;

        await tx.salesOrderDocumentNumber.create({
          data: {
            shop,
            templateId,
            orderGid,
            sequence,
            documentNumber,
          },
        });

        await tx.salesOrderNumberCounter.update({
          where: { id: counter.id },
          data: {
            nextValue: sequence + 1,
            prefix,
            padLength,
          },
        });

        return documentNumber;
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      // Unique constraint race — retry with a fresh counter read.
      if (code === "P2002") continue;
      throw error;
    }
  }

  throw new Error(
    "Could not allocate a unique sales order number. Please try again.",
  );
}

export type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/** Oldest → newest Shopify order GIDs for sequential backfill. */
export async function fetchAllOrderGidsOldestFirst(
  admin: AdminGraphql,
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query BackfillSalesOrderIds($first: Int!, $after: String) {
          orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: false) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
            }
          }
        }`,
      {
        variables: {
          first: 100,
          after,
        },
      },
    );

    const payload = (await response.json()) as {
      data?: {
        orders?: {
          pageInfo?: {
            hasNextPage?: boolean;
            endCursor?: string | null;
          };
          nodes?: Array<{ id?: string | null }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(
        payload.errors.map((error) => error.message).join("; ") ||
          "Failed to load Shopify orders for numbering.",
      );
    }

    const connection = payload.data?.orders;
    for (const node of connection?.nodes ?? []) {
      if (node?.id) ids.push(node.id);
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    after = connection?.pageInfo?.endCursor ?? null;
    if (!hasNextPage || !after) break;

    // Safety cap for very large stores (App Bridge / action timeouts).
    if (ids.length >= 5000) break;
  }

  return ids;
}

/**
 * Assigns document numbers to existing Shopify orders that do not have one yet.
 * Orders are numbered oldest → newest. Already assigned numbers are never changed.
 */
export async function backfillSalesOrderDocumentNumbers(
  shop: string,
  templateId: string,
  numbering: NumberingSettings,
  orderGids: string[],
  options?: { persistUndo?: boolean },
): Promise<{
  assigned: number;
  skipped: number;
  lastNumber: string | null;
  lastAllocatedSequence: number | null;
  canUndo: boolean;
}> {
  await syncNumberCounter(shop, templateId, numbering);

  const counterBefore = await prisma.salesOrderNumberCounter.findUnique({
    where: { shop_templateId: { shop, templateId } },
    select: { nextValue: true },
  });
  const previousNextValue =
    counterBefore?.nextValue ?? numberingMeta(numbering).startAt;

  let assigned = 0;
  let skipped = 0;
  let lastNumber: string | null = null;
  const assignedOrderGids: string[] = [];

  const existingRows = await prisma.salesOrderDocumentNumber.findMany({
    where: {
      shop,
      templateId,
      orderGid: { in: orderGids },
    },
    select: { orderGid: true },
  });
  const existingGids = new Set(existingRows.map((row) => row.orderGid));

  for (const orderGid of orderGids) {
    if (existingGids.has(orderGid)) {
      skipped += 1;
      continue;
    }

    lastNumber = await allocateSalesOrderDocumentNumber(
      shop,
      templateId,
      orderGid,
      numbering,
    );
    assignedOrderGids.push(orderGid);
    assigned += 1;
  }

  if (options?.persistUndo === true && assignedOrderGids.length > 0) {
    await saveNumberBackfillUndo(shop, {
      templateId,
      orderGids: assignedOrderGids,
      previousNextValue,
      assignedCount: assignedOrderGids.length,
      assignedAt: new Date().toISOString(),
    });
  }

  return {
    assigned,
    skipped,
    lastNumber,
    lastAllocatedSequence: await getLastAllocatedSequence(shop),
    canUndo: options?.persistUndo === true && assignedOrderGids.length > 0,
  };
}

export type NumberBackfillUndoSnapshot = {
  templateId: string;
  orderGids: string[];
  previousNextValue: number;
  assignedCount: number;
  assignedAt: string;
};

function normalizeBackfillUndo(value: unknown): NumberBackfillUndoSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<NumberBackfillUndoSnapshot>;
  if (typeof input.templateId !== "string" || !input.templateId) return null;
  if (!Array.isArray(input.orderGids) || input.orderGids.length === 0) return null;
  const orderGids = input.orderGids.filter(
    (gid): gid is string => typeof gid === "string" && gid.length > 0,
  );
  if (orderGids.length === 0) return null;
  const previousNextValue = Number(input.previousNextValue);
  const assignedCount = Number(input.assignedCount);
  if (!Number.isFinite(previousNextValue) || previousNextValue < 0) return null;
  return {
    templateId: input.templateId,
    orderGids,
    previousNextValue,
    assignedCount: Number.isFinite(assignedCount)
      ? assignedCount
      : orderGids.length,
    assignedAt:
      typeof input.assignedAt === "string"
        ? input.assignedAt
        : new Date().toISOString(),
  };
}

export async function loadNumberBackfillUndo(
  shop: string,
): Promise<NumberBackfillUndoSnapshot | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ numberBackfillUndo: unknown }>>`
      SELECT "numberBackfillUndo"
      FROM "ShopSettings"
      WHERE shop = ${shop}
      LIMIT 1
    `;
    return normalizeBackfillUndo(rows[0]?.numberBackfillUndo);
  } catch {
    return null;
  }
}

/** Undo availability for Settings UI — blocked when any assigned order is invoiced. */
export async function getNumberBackfillUndoStatus(shop: string): Promise<{
  assignedCount: number;
  assignedAt: string;
  canUndo: boolean;
  invoicedCount: number;
} | null> {
  const snapshot = await loadNumberBackfillUndo(shop);
  if (!snapshot) return null;

  const invoiced = await getInvoicedOrderGids(shop, snapshot.orderGids);
  const invoicedCount = invoiced.size;

  return {
    assignedCount: snapshot.assignedCount,
    assignedAt: snapshot.assignedAt,
    canUndo: invoicedCount === 0,
    invoicedCount,
  };
}

async function saveNumberBackfillUndo(
  shop: string,
  snapshot: NumberBackfillUndoSnapshot | null,
): Promise<void> {
  const payload = snapshot ? JSON.stringify(snapshot) : null;
  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ShopSettings" WHERE shop = ${shop} LIMIT 1
    `;
    if (existing[0]) {
      await prisma.$executeRaw`
        UPDATE "ShopSettings"
        SET "numberBackfillUndo" = ${payload}::jsonb,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop}
      `;
      return;
    }
    await prisma.$executeRaw`
      INSERT INTO "ShopSettings" (
        id,
        shop,
        "storeDetails",
        "smtpSettings",
        "selectedTemplates",
        "numberSeries",
        "numberBackfillUndo",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${shop},
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${JSON.stringify({})}::jsonb,
        ${payload}::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
  } catch {
    // Column may be missing until migrate — ignore so assign still works.
  }
}

/**
 * Reverts the last "Assign to existing orders" run: deletes those SO numbers
 * and realigns the counter to remaining allocations.
 * Blocked when any of those orders has been converted to an invoice.
 */
export async function revertLastSalesOrderNumberBackfill(
  shop: string,
): Promise<
  | {
      ok: true;
      reverted: number;
      lastAllocatedSequence: number | null;
      templateId: string | null;
    }
  | {
      ok: false;
      error: string;
      invoicedCount: number;
    }
> {
  const snapshot = await loadNumberBackfillUndo(shop);
  if (!snapshot) {
    return {
      ok: true,
      reverted: 0,
      lastAllocatedSequence: null,
      templateId: null,
    };
  }

  const invoiced = await getInvoicedOrderGids(shop, snapshot.orderGids);
  if (invoiced.size > 0) {
    return {
      ok: false,
      error:
        "Cannot undo: one or more assigned orders were converted to invoice. Delete those invoices first, then undo.",
      invoicedCount: invoiced.size,
    };
  }

  const { templateId, orderGids } = snapshot;
  const result = await prisma.salesOrderDocumentNumber.deleteMany({
    where: {
      shop,
      templateId,
      orderGid: { in: orderGids },
    },
  });

  const last = await getLastAllocatedSequence(shop);
  const nextValue = last == null ? snapshot.previousNextValue : last + 1;
  const counter = await prisma.salesOrderNumberCounter.findUnique({
    where: { shop_templateId: { shop, templateId } },
  });
  if (counter) {
    await prisma.salesOrderNumberCounter.update({
      where: { shop_templateId: { shop, templateId } },
      data: { nextValue },
    });
  }

  await saveNumberBackfillUndo(shop, null);
  return {
    ok: true,
    reverted: result.count,
    lastAllocatedSequence: last,
    templateId,
  };
}


export type SalesOrderDocumentDetails = {
  documentNumber: string;
  documentDate: Date | null;
  customerNote: string | null;
  terms: string | null;
};

export async function getSalesOrderDocumentDetails(
  shop: string,
  templateId: string,
  orderGid: string,
): Promise<SalesOrderDocumentDetails | null> {
  const rows = await prisma.$queryRaw<
    Array<{
      documentNumber: string;
      documentDate: Date | null;
      customerNote: string | null;
      terms: string | null;
      templateId: string;
    }>
  >`
    SELECT "documentNumber", "documentDate", "customerNote", terms, "templateId"
    FROM "SalesOrderDocumentNumber"
    WHERE shop = ${shop}
      AND "orderGid" = ${orderGid}
    ORDER BY CASE WHEN "templateId" = ${templateId} THEN 0 ELSE 1 END,
             "createdAt" ASC
    LIMIT 1
  `;
  return rows[0]
    ? {
        documentNumber: rows[0].documentNumber,
        documentDate: rows[0].documentDate,
        customerNote: rows[0].customerNote,
        terms: rows[0].terms,
      }
    : null;
}

export type UpdateSalesOrderDetailsInput = {
  documentNumber: string;
  documentDate: Date;
  customerNote: string;
  terms: string;
  /**
   * `continue` (default): keep auto series; next new orders start after this number.
   * `manual`: switch shop to manual SO numbering after save.
   */
  numberMode?: "continue" | "manual";
};

/** Update SO number, date, customer note, and terms for one order. */
export async function updateSalesOrderDocumentDetails(
  shop: string,
  templateId: string,
  orderGid: string,
  input: UpdateSalesOrderDetailsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const documentNumber = input.documentNumber.trim();
  const documentDate = input.documentDate;
  const customerNote = input.customerNote.trim();
  const terms = input.terms.trim();
  const numberMode = input.numberMode === "manual" ? "manual" : "continue";

  if (!documentNumber) {
    return { ok: false, error: "Sales order number is required" };
  }
  if (Number.isNaN(documentDate.getTime())) {
    return { ok: false, error: "Invalid order date" };
  }

  const existing = await prisma.$queryRaw<Array<{ orderGid: string }>>`
    SELECT "orderGid"
    FROM "SalesOrderDocumentNumber"
    WHERE shop = ${shop}
      AND "templateId" = ${templateId}
      AND "orderGid" = ${orderGid}
    LIMIT 1
  `;
  if (!existing[0]) {
    return { ok: false, error: "Sales order number not found" };
  }

  const conflict = await prisma.$queryRaw<Array<{ orderGid: string }>>`
    SELECT "orderGid"
    FROM "SalesOrderDocumentNumber"
    WHERE shop = ${shop}
      AND "templateId" = ${templateId}
      AND "documentNumber" = ${documentNumber}
      AND "orderGid" <> ${orderGid}
    LIMIT 1
  `;
  if (conflict[0]) {
    return {
      ok: false,
      error: `Sales order number ${documentNumber} is already used`,
    };
  }

  try {
    const series = await loadNumberSeriesEntryForShop(shop, "sales-order");
    const parsed = parseNumberSeriesDigits(documentNumber, series);
    const sequence = parsed?.sequence ?? null;

    // Free unique (shop, templateId, sequence) if another row owns this number.
    if (sequence != null) {
      await prisma.$executeRaw`
        UPDATE "SalesOrderDocumentNumber"
        SET sequence = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE shop = ${shop}
          AND "templateId" = ${templateId}
          AND sequence = ${sequence}
          AND "orderGid" <> ${orderGid}
      `;
    }

    await prisma.$executeRaw`
      UPDATE "SalesOrderDocumentNumber"
      SET
        "documentNumber" = ${documentNumber},
        sequence = ${sequence},
        "documentDate" = ${documentDate},
        "customerNote" = ${customerNote || null},
        terms = ${terms || null},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE shop = ${shop}
        AND "templateId" = ${templateId}
        AND "orderGid" = ${orderGid}
    `;

    // Continue auto series after this number (SO-0006 → next SO-0007).
    if (parsed) {
      await syncNumberCounter(
        shop,
        templateId,
        numberingFromSeries(series),
        parsed.sequence + 1,
      );

      const allSeries = await loadNumberSeriesForShop(shop);
      const current = allSeries["sales-order"];
      const widened = widenStartingNumberPad(
        current.startingNumber,
        parsed.digitWidth,
      );
      const nextEntryMode =
        numberMode === "manual" ? ("manual" as const) : ("auto" as const);
      if (
        widened !== current.startingNumber ||
        current.entryMode !== nextEntryMode
      ) {
        await saveNumberSeriesForShop(shop, {
          ...allSeries,
          "sales-order": {
            ...current,
            startingNumber: widened,
            entryMode: nextEntryMode,
          },
        });
      }
    } else if (numberMode === "manual") {
      await saveNumberSeriesEntryMode(shop, "sales-order", "manual");
    } else {
      const current = await loadNumberSeriesEntryForShop(shop, "sales-order");
      if (current.entryMode === "manual") {
        await saveNumberSeriesEntryMode(shop, "sales-order", "auto");
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update sales order";
    if (/unique|duplicate/i.test(message)) {
      return {
        ok: false,
        error: `Sales order number ${documentNumber} is already used`,
      };
    }
    return { ok: false, error: message };
  }

  return { ok: true };
}
