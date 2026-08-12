import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "./db.server";
import { getCurrentPlanId, planHasCapability } from "./plan-access";
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
    // Reject `#7374577533169`-style values that are just the Order GID id.
    const bare = name.replace(/^#/, "");
    const gidNumeric = gid?.split("/").pop();
    if (gidNumeric && bare === gidNumeric) {
      name = null;
    }
  }

  return { orderGid: gid, orderName: name };
}

export async function recordDocumentEvent(
  args: RecordDocumentEventInput,
): Promise<void> {
  if (!args.shop || !isDocumentEventAction(args.action)) return;
  // Event log is ULTIMATE-only — do not write updates on lower plans.
  if (!planHasCapability(getCurrentPlanId(), "eventLog")) return;
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

function mapEventLogRow(row: EventLogRow): DocumentEventLogItem {
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
  const count = Number(row.count) || 1;
  return {
    id: row.id,
    action,
    documentKind: row.documentKind,
    documentNumber: row.documentNumber,
    orderGid: identity.orderGid,
    orderName: identity.orderName,
    processType,
    count,
    message: buildDocumentEventMessage({
      action,
      count,
      documentKind: row.documentKind,
      documentNumber: row.documentNumber,
      orderName: identity.orderName,
      orderGid: identity.orderGid,
      processType,
    }),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

const ORDER_NAMES_BY_IDS_QUERY = `#graphql
  query DocumentEventOrderNames($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        name
      }
    }
  }
`;

/**
 * Fill merchant order names (#1009) for events that only stored the Shopify
 * Order id. Persists the fix so Event Logs stay correct after refresh.
 */
export async function enrichDocumentEventsWithOrderNames(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  events: DocumentEventLogItem[],
): Promise<DocumentEventLogItem[]> {
  const needsName = events.filter(
    (event) => event.orderGid && !event.orderName,
  );
  if (needsName.length === 0) return events;

  const ids = [
    ...new Set(
      needsName
        .map((event) => event.orderGid)
        .filter((gid): gid is string => Boolean(gid)),
    ),
  ];

  const nameByGid = new Map<string, string>();
  try {
    const response = await admin.graphql(ORDER_NAMES_BY_IDS_QUERY, {
      variables: { ids },
    });
    const json = (await response.json()) as {
      data?: { nodes?: Array<{ id?: string; name?: string } | null> };
    };
    for (const node of json.data?.nodes || []) {
      if (!node?.id || !node.name) continue;
      const formatted = node.name.startsWith("#")
        ? node.name
        : `#${node.name.replace(/^#/, "")}`;
      nameByGid.set(node.id, formatted);
    }
  } catch (error) {
    console.error("[document-event-log] order name lookup failed", error);
    return events;
  }

  if (nameByGid.size === 0) return events;

  const updated = events.map((event) => {
    if (event.orderName || !event.orderGid) return event;
    const orderName = nameByGid.get(event.orderGid) || null;
    if (!orderName) return event;
    const message = buildDocumentEventMessage({
      action: event.action,
      count: event.count,
      documentKind: event.documentKind,
      documentNumber: event.documentNumber,
      orderName,
      orderGid: event.orderGid,
      processType: event.processType,
    });
    return { ...event, orderName, message };
  });

  void Promise.all(
    updated
      .filter((event) => {
        const prior = events.find((row) => row.id === event.id);
        return prior && !prior.orderName && event.orderName;
      })
      .map(async (event) => {
        try {
          await prisma.$executeRaw`
            UPDATE "DocumentEventLog"
            SET
              "orderName" = ${event.orderName},
              message = ${event.message}
            WHERE id = ${event.id}
          `;
        } catch (error) {
          console.error(
            "[document-event-log] persist order name failed",
            event.id,
            error,
          );
        }
      }),
  );

  return updated;
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

    return rows.map(mapEventLogRow);
  } catch (error) {
    console.error("[document-event-log] load failed", shop, error);
    return [];
  }
}

export type DocumentActionFlags = {
  printed: boolean;
  downloaded: boolean;
  sent: boolean;
};

function orderGidLookupKeys(gid: string): string[] {
  const raw = gid.trim();
  if (!raw) return [];
  const keys = new Set<string>([raw]);
  const last = raw.includes("/") ? raw.split("/").pop() || raw : raw;
  if (/^\d+$/.test(last)) {
    keys.add(last);
    keys.add(`gid://shopify/Order/${last}`);
  }
  return [...keys];
}

/** Whether this order has been printed / downloaded / emailed. */
export async function getDocumentActionFlagsByOrderGids(
  shop: string,
  orderGids: string[],
  _documentKind?: string | null,
): Promise<Map<string, DocumentActionFlags>> {
  const flags = new Map<string, DocumentActionFlags>();
  if (!shop || orderGids.length === 0) return flags;

  const lookupKeys = [...new Set(orderGids.flatMap(orderGidLookupKeys))];
  const listIdByKey = new Map<string, string>();
  for (const gid of orderGids) {
    for (const key of orderGidLookupKeys(gid)) {
      listIdByKey.set(key, gid);
    }
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{ orderGid: string | null; action: string }>
    >`
      SELECT "orderGid", action
      FROM "DocumentEventLog"
      WHERE shop = ${shop}
        AND action IN ('printed', 'downloaded', 'sent')
        AND "orderGid" IN (${Prisma.join(lookupKeys)})
    `;
    for (const row of rows) {
      if (!row.orderGid) continue;
      const listId = listIdByKey.get(row.orderGid);
      if (!listId) continue;
      const current = flags.get(listId) ?? {
        printed: false,
        downloaded: false,
        sent: false,
      };
      if (row.action === "printed") current.printed = true;
      if (row.action === "downloaded") current.downloaded = true;
      if (row.action === "sent") current.sent = true;
      flags.set(listId, current);
    }
  } catch (error) {
    console.error("[document-event-log] action flags failed", shop, error);
  }

  return flags;
}
