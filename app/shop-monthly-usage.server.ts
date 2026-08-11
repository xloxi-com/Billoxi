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

export type DailyUsagePoint = {
  /** YYYY-MM-DD (UTC) */
  date: string;
  /** Short axis label, e.g. Aug 3 */
  label: string;
  printed: number;
  downloaded: number;
  sent: number;
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

function utcDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

/**
 * Last N UTC days of printed / downloaded / sent from DocumentEventLog.
 * Missing days are filled with zeros for a stable chart axis.
 */
export async function loadDailyUsageSeries(
  shop: string,
  days = 14,
  now = new Date(),
): Promise<DailyUsagePoint[]> {
  const dayCount = Math.max(1, Math.min(days, 31));
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (dayCount - 1));
  start.setUTCHours(0, 0, 0, 0);

  const series: DailyUsagePoint[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    series.push({
      date: utcDayKey(day),
      label: shortDayLabel(day),
      printed: 0,
      downloaded: 0,
      sent: 0,
    });
  }
  const byDate = new Map(series.map((point) => [point.date, point]));

  try {
    type AggRow = {
      day: Date | string;
      action: string;
      total: number | bigint;
    };
    const rows = await prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT
        date_trunc('day', "createdAt") AS day,
        action,
        COALESCE(SUM(count), 0) AS total
      FROM "DocumentEventLog"
      WHERE shop = $1
        AND "createdAt" >= $2
        AND "createdAt" <= $3
        AND action IN ('printed', 'downloaded', 'sent')
      GROUP BY 1, 2
      ORDER BY 1 ASC`,
      shop,
      start,
      end,
    );

    for (const row of rows) {
      const dayDate =
        row.day instanceof Date ? row.day : new Date(String(row.day));
      const key = utcDayKey(dayDate);
      const point = byDate.get(key);
      if (!point) continue;
      const total = Number(row.total) || 0;
      if (row.action === "printed") point.printed = total;
      else if (row.action === "downloaded") point.downloaded = total;
      else if (row.action === "sent") point.sent = total;
    }
  } catch (error) {
    console.error("[shop-monthly-usage] daily series failed", shop, error);
  }

  return series;
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
    if (
      metric === "printed" ||
      metric === "downloaded" ||
      metric === "sent"
    ) {
      const { invalidateSalesOrdersCache } = await import(
        "./sales-orders.server"
      );
      invalidateSalesOrdersCache(shop);
    }
  } catch (error) {
    console.error("[shop-monthly-usage] increment failed", shop, metric, error);
  }
}
