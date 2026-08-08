import prisma from "./db.server";
import {
  recordDocumentEvent,
  type RecordDocumentEventInput,
} from "./document-event-log.server";
import type { DocumentEventAction } from "./document-event-log";

export type ShopMonthlyUsageMetric =
  | "printed"
  | "downloaded"
  | "sent"
  | "uploaded";

export type ShopMonthlyUsageCounts = {
  printed: number;
  downloaded: number;
  sent: number;
  uploaded: number;
  yearMonth: string;
};

type MonthlyUsageRow = {
  printed: number;
  downloaded: number;
  sent: number;
  uploaded: number;
};

type ShopMonthlyUsageDelegate = {
  findUnique: (args: {
    where: { shop_yearMonth: { shop: string; yearMonth: string } };
  }) => Promise<MonthlyUsageRow | null>;
  upsert: (args: {
    where: { shop_yearMonth: { shop: string; yearMonth: string } };
    create: {
      shop: string;
      yearMonth: string;
      printed: number;
      downloaded: number;
      sent: number;
      uploaded: number;
    };
    update: Record<string, { increment: number }>;
  }) => Promise<unknown>;
};

function shopMonthlyUsageDelegate(): ShopMonthlyUsageDelegate | null {
  const delegate = (
    prisma as { shopMonthlyUsage?: ShopMonthlyUsageDelegate }
  ).shopMonthlyUsage;
  return delegate && typeof delegate.findUnique === "function"
    ? delegate
    : null;
}

export function currentYearMonth(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export async function loadShopMonthlyUsage(
  shop: string,
  now = new Date(),
): Promise<ShopMonthlyUsageCounts> {
  const yearMonth = currentYearMonth(now);
  const usage = shopMonthlyUsageDelegate();
  const row = usage
    ? await usage
        .findUnique({
          where: { shop_yearMonth: { shop, yearMonth } },
        })
        .catch(() => null)
    : null;

  return {
    yearMonth,
    printed: row?.printed ?? 0,
    downloaded: row?.downloaded ?? 0,
    sent: row?.sent ?? 0,
    uploaded: row?.uploaded ?? 0,
  };
}

export type IncrementUsageOptions = Omit<
  RecordDocumentEventInput,
  "shop" | "action" | "count"
> & {
  skipEventLog?: boolean;
};

export async function incrementShopMonthlyUsage(
  shop: string,
  metric: ShopMonthlyUsageMetric,
  by = 1,
  options?: IncrementUsageOptions,
  now = new Date(),
): Promise<void> {
  if (!shop || by <= 0) return;
  const usage = shopMonthlyUsageDelegate();
  if (!usage) {
    console.warn(
      "[shop-monthly-usage] Prisma model missing — restart app after prisma generate",
    );
    return;
  }

  const yearMonth = currentYearMonth(now);
  const data = { [metric]: { increment: by } } as Record<
    ShopMonthlyUsageMetric,
    { increment: number }
  >;

  try {
    await usage.upsert({
      where: { shop_yearMonth: { shop, yearMonth } },
      create: {
        shop,
        yearMonth,
        printed: metric === "printed" ? by : 0,
        downloaded: metric === "downloaded" ? by : 0,
        sent: metric === "sent" ? by : 0,
        uploaded: metric === "uploaded" ? by : 0,
      },
      update: data,
    });
    if (!options?.skipEventLog) {
      await recordDocumentEvent({
        shop,
        action: metric as DocumentEventAction,
        count: by,
        documentKind: options?.documentKind,
        documentNumber: options?.documentNumber,
        orderGid: options?.orderGid,
        orderName: options?.orderName,
        processType: options?.processType ?? "manual",
      });
    }
  } catch (error) {
    console.error("[shop-monthly-usage] increment failed", shop, metric, error);
  }
}
