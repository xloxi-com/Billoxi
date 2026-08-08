import { randomBytes } from "node:crypto";

import prisma from "./db.server";
import {
  buildDocumentEventMessage,
  isDocumentEventAction,
  isDocumentEventProcessType,
  type DocumentEventAction,
  type DocumentEventLogItem,
  type DocumentEventProcessType,
} from "./document-event-log";

export type { DocumentEventAction, DocumentEventLogItem, DocumentEventProcessType };

export type RecordDocumentEventInput = {
  shop: string;
  action: DocumentEventAction;
  count?: number;
  documentKind?: string | null;
  documentNumber?: string | null;
  orderGid?: string | null;
  orderName?: string | null;
  processType?: DocumentEventProcessType | null;
};

type EventLogRow = {
  id: string;
  action: string;
  documentKind: string | null;
  documentNumber: string | null;
  orderGid: string | null;
  orderName: string | null;
  processType: string | null;
  count: number | bigint;
  message: string | null;
  createdAt: Date;
};

function newEventId(): string {
  return `evt_${randomBytes(12).toString("hex")}`;
}

/** Normalize Shopify order GID + display name (#1234). */
export function normalizeOrderIdentity(args: {
  orderGid?: string | null;
  orderName?: string | null;
}): { orderGid: string | null; orderName: string | null } {
  let gid = args.orderGid?.trim() || null;
  let name = args.orderName?.trim() || null;

  if (gid) {
    if (gid.startsWith("gid://shopify/Order/")) {
      // keep
    } else if (/^\d+$/.test(gid)) {
      gid = `gid://shopify/Order/${gid}`;
    } else if (gid.includes("/")) {
      const last = gid.split("/").pop();
      if (last && /^\d+$/.test(last)) {
        gid = `gid://shopify/Order/${last}`;
      }
    }
  }

  if (name) {
    name = name.startsWith("#") ? name : `#${name.replace(/^#/, "")}`;
  } else if (gid) {
    const numeric = gid.split("/").pop();
    if (numeric && /^\d+$/.test(numeric)) {
      name = `#${numeric}`;
    }
  }

  return { orderGid: gid, orderName: name };
}

export async function recordDocumentEvent(
  args: RecordDocumentEventInput,
): Promise<void> {
  if (!args.shop || !isDocumentEventAction(args.action)) return;
  const count = Math.max(1, Math.min(args.count ?? 1, 500));
  const processType = isDocumentEventProcessType(args.processType)
    ? args.processType
    : "manual";
  const { orderGid, orderName } = normalizeOrderIdentity({
    orderGid: args.orderGid,
    orderName: args.orderName,
  });

  const message = buildDocumentEventMessage({
    action: args.action,
    count,
    documentKind: args.documentKind,
    documentNumber: args.documentNumber,
    orderName,
    orderGid,
    processType,
  });

  const id = newEventId();
  const documentKind = args.documentKind?.trim() || null;
  const documentNumber = args.documentNumber?.trim() || null;

  try {
    await prisma.$executeRaw`
      INSERT INTO "DocumentEventLog" (
        id,
        shop,
        action,
        "documentKind",
        "documentNumber",
        "orderGid",
        "orderName",
        "processType",
        count,
        message,
        "createdAt"
      )
      VALUES (
        ${id},
        ${args.shop},
        ${args.action},
        ${documentKind},
        ${documentNumber},
        ${orderGid},
        ${orderName},
        ${processType},
        ${count},
        ${message},
        NOW()
      )
    `;
  } catch (error) {
    console.error("[document-event-log] create failed", args.shop, {
      action: args.action,
      orderGid,
      orderName,
      documentKind,
      error,
    });
  }
}

export async function loadRecentDocumentEvents(
  shop: string,
  limit = 20,
): Promise<DocumentEventLogItem[]> {
  const take = Math.max(1, Math.min(limit, 100));

  try {
    // Avoid parameterized LIMIT (can fail on some Prisma/PG setups).
    const rows = await prisma.$queryRawUnsafe<EventLogRow[]>(
      `SELECT
        id,
        action,
        "documentKind",
        "documentNumber",
        "orderGid",
        "orderName",
        "processType",
        count,
        message,
        "createdAt"
      FROM "DocumentEventLog"
      WHERE shop = $1
        AND (
          ("orderGid" IS NOT NULL AND trim("orderGid") <> '')
          OR ("orderName" IS NOT NULL AND trim("orderName") <> '')
        )
      ORDER BY "createdAt" DESC
      LIMIT ${take}`,
      shop,
    );

    return rows.map((row) => {
      const action = isDocumentEventAction(row.action)
        ? row.action
        : "downloaded";
      const processType = isDocumentEventProcessType(row.processType)
        ? row.processType
        : null;
      const identity = normalizeOrderIdentity({
        orderGid: row.orderGid,
        orderName: row.orderName,
      });
      return {
        id: row.id,
        action,
        documentKind: row.documentKind,
        documentNumber: row.documentNumber,
        orderGid: identity.orderGid,
        orderName: identity.orderName,
        processType,
        count: Number(row.count) || 1,
        message:
          row.message ||
          buildDocumentEventMessage({
            action,
            count: Number(row.count) || 1,
            documentKind: row.documentKind,
            documentNumber: row.documentNumber,
            orderName: identity.orderName,
            orderGid: identity.orderGid,
            processType,
          }),
        createdAt: new Date(row.createdAt).toISOString(),
      };
    });
  } catch (error) {
    console.error("[document-event-log] load failed", shop, error);
    return [];
  }
}
