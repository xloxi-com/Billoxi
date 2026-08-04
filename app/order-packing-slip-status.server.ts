import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import prisma from "./db.server";

type OrderGidRow = { orderGid: string };

function hasPackingSlipDelegate() {
  return (
    typeof (prisma as { orderPackingSlipStatus?: unknown })
      .orderPackingSlipStatus === "object"
  );
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

/** Mark a Shopify order as packing-slip converted (idempotent). */
export async function markOrderPackingSlip(shop: string, orderGid: string) {
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
    return;
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
}
