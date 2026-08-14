import {
  BlockStack,
  Box,
  Icon,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { EmailIcon, ImportIcon, PrintIcon } from "@shopify/polaris-icons";

import type { DailyUsagePoint } from "../shop-monthly-usage.server";
import { useAdminI18n } from "../admin-i18n-context";

import "./home-analytics.css";

type AnalyticsMetric = {
  key: "printed" | "downloaded" | "sent";
  label: string;
  value: number;
};

const CHART_SERIES_META = [
  {
    key: "printed" as const,
    labelKey: "home.chartPrinted" as const,
    cssVar: "--billoxi-analytics-printed",
  },
  {
    key: "downloaded" as const,
    labelKey: "home.chartDownloaded" as const,
    cssVar: "--billoxi-analytics-downloaded",
  },
  {
    key: "sent" as const,
    labelKey: "home.chartSent" as const,
    cssVar: "--billoxi-analytics-sent",
  },
] as const;

const METRIC_ICONS = {
  printed: PrintIcon,
  downloaded: ImportIcon,
  sent: EmailIcon,
} as const;

function formatMetricValue(value: number) {
  return value.toLocaleString();
}

function buildYTicks(maxValue: number): number[] {
  if (maxValue <= 1) return [0, 1];
  if (maxValue <= 4) {
    return Array.from({ length: maxValue + 1 }, (_, index) => index);
  }
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const ticks: number[] = [0];
  for (let value = step; value < maxValue; value += step) {
    ticks.push(value);
  }
  if (ticks[ticks.length - 1] !== maxValue) ticks.push(maxValue);
  return ticks;
}

function AnalyticsMetricCard({ metric }: { metric: AnalyticsMetric }) {
  const SourceIcon = METRIC_ICONS[metric.key];

  return (
    <Box
      background="bg-surface-secondary"
      borderRadius="300"
      padding="400"
      minHeight="100%"
    >
      <InlineStack align="space-between" blockAlign="start" wrap={false}>
        <BlockStack gap="050">
          <Text as="p" variant="bodySm" tone="subdued">
            {metric.label}
          </Text>
          <Text as="p" variant="headingLg" fontWeight="bold">
            {formatMetricValue(metric.value)}
          </Text>
        </BlockStack>
        <span
          className={`billoxi-analytics-metric-icon billoxi-analytics-metric-icon--${metric.key}`}
          aria-hidden
        >
          <Icon source={SourceIcon} tone="subdued" />
        </span>
      </InlineStack>
    </Box>
  );
}

function UsageStatisticsChart({ series }: { series: DailyUsagePoint[] }) {
  const { t } = useAdminI18n();
  const chartSeries = CHART_SERIES_META.map((item) => ({
    ...item,
    label: t(item.labelKey),
  }));
  const width = 720;
  const height = 228;
  const pad = { top: 12, right: 8, bottom: 40, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxValue = Math.max(
    1,
    ...series.flatMap((point) => [
      point.printed,
      point.downloaded,
      point.sent,
    ]),
  );
  const totalActivity = series.reduce(
    (sum, point) => sum + point.printed + point.downloaded + point.sent,
    0,
  );
  const groupCount = Math.max(series.length, 1);
  const groupWidth = plotW / groupCount;
  const barGap = 3;
  const barWidth = Math.max(
    4,
    Math.min(12, (groupWidth - 10) / chartSeries.length - barGap),
  );
  const yTicks = buildYTicks(maxValue);

  return (
    <Box
      background="bg-surface"
      borderColor="border"
      borderWidth="025"
      borderRadius="300"
      padding="400"
    >
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap gap="300">
          <BlockStack gap="050">
            <Text as="h3" variant="headingSm">
              {t("home.chartTitle")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("home.chartSubtitle")}
            </Text>
          </BlockStack>
          <InlineStack gap="300" wrap>
            {chartSeries.map((item) => (
              <InlineStack key={item.key} gap="150" blockAlign="center">
                <span
                  className="billoxi-analytics-legend-swatch"
                  style={{ background: `var(${item.cssVar})` }}
                  aria-hidden
                />
                <Text as="span" variant="bodySm" tone="subdued">
                  {item.label}
                </Text>
              </InlineStack>
            ))}
          </InlineStack>
        </InlineStack>

        {totalActivity === 0 ? (
          <Box
            background="bg-surface-secondary"
            borderRadius="200"
            padding="600"
          >
            <Text as="p" alignment="center" tone="subdued" variant="bodySm">
              {t("home.chartEmpty")}
            </Text>
          </Box>
        ) : (
          <div className="billoxi-analytics-chart-scroll">
            <svg
              className="billoxi-analytics-chart"
              viewBox={`0 0 ${width} ${height}`}
              width="100%"
              height="228"
              role="img"
              aria-label={t("home.chartAria")}
            >
              {yTicks.map((tick) => {
                const y = pad.top + plotH - (tick / maxValue) * plotH;
                return (
                  <g key={`y-${tick}`}>
                    <line
                      className="billoxi-analytics-chart-grid"
                      x1={pad.left}
                      x2={width - pad.right}
                      y1={y}
                      y2={y}
                    />
                    <text
                      className="billoxi-analytics-chart-axis"
                      x={pad.left - 10}
                      y={y + 4}
                      textAnchor="end"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {series.map((point, index) => {
                const groupX = pad.left + index * groupWidth;
                const clusterWidth =
                  chartSeries.length * barWidth +
                  (chartSeries.length - 1) * barGap;
                const startX = groupX + (groupWidth - clusterWidth) / 2;
                const showLabel =
                  index % 2 === 0 || index === series.length - 1;

                return (
                  <g key={point.date}>
                    {chartSeries.map((item, barIndex) => {
                      const value = point[item.key];
                      const barH = (value / maxValue) * plotH;
                      const x = startX + barIndex * (barWidth + barGap);
                      const y = pad.top + plotH - barH;
                      return (
                        <rect
                          key={item.key}
                          className="billoxi-analytics-chart-bar"
                          style={{ fill: `var(${item.cssVar})` }}
                          x={x}
                          y={y}
                          width={barWidth}
                          height={Math.max(barH, value > 0 ? 3 : 0)}
                          rx={3}
                        >
                          <title>
                            {item.label}: {value} on {point.label}
                          </title>
                        </rect>
                      );
                    })}
                    {showLabel ? (
                      <text
                        className="billoxi-analytics-chart-axis"
                        x={groupX + groupWidth / 2}
                        y={height - 14}
                        textAnchor="middle"
                      >
                        {point.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        )}
      </BlockStack>
    </Box>
  );
}

export type HomeAnalyticsProps = {
  printed: number;
  downloaded: number;
  sent: number;
  series: DailyUsagePoint[];
  chartLocked?: boolean;
  onUnlockChart?: () => void;
  orderQuota?: {
    used: number;
    limit: number | null;
    remaining: number | null;
    exhausted: boolean;
    yearMonth: string;
  } | null;
  onUpgradePlan?: () => void;
};

export function HomeAnalyticsSection({
  printed,
  downloaded,
  sent,
  series,
  chartLocked = false,
  onUnlockChart,
  orderQuota = null,
  onUpgradePlan,
}: HomeAnalyticsProps) {
  const { t } = useAdminI18n();
  const metrics: AnalyticsMetric[] = [
    { key: "printed", label: t("home.monthlyPrinted"), value: printed },
    {
      key: "downloaded",
      label: t("home.monthlyDownloaded"),
      value: downloaded,
    },
    { key: "sent", label: t("home.monthlySent"), value: sent },
  ];
  const quotaProgress =
    orderQuota?.limit != null && orderQuota.limit > 0
      ? Math.min(100, Math.round((orderQuota.used / orderQuota.limit) * 100))
      : null;

  return (
    <div className="billoxi-analytics">
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("home.analytics")}
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            {t("home.analyticsSubtitle")}
          </Text>
        </BlockStack>

        {orderQuota && orderQuota.limit != null ? (
          <Box
            background="bg-surface-secondary"
            borderRadius="300"
            padding="400"
          >
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center" wrap>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {t("home.orderQuotaTitle")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {orderQuota.used} / {orderQuota.limit} {t("home.orderQuotaUnit")}
                </Text>
              </InlineStack>
              {quotaProgress != null ? (
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    background: "var(--p-color-bg-fill-secondary, #e3e3e3)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${quotaProgress}%`,
                      height: "100%",
                      background: orderQuota.exhausted
                        ? "var(--p-color-bg-fill-critical, #ce0e2d)"
                        : "var(--p-color-bg-fill-brand, #303030)",
                    }}
                  />
                </div>
              ) : null}
              <Text as="p" tone="subdued" variant="bodySm">
                {orderQuota.exhausted
                  ? t("home.orderQuotaExhausted")
                  : t("home.orderQuotaHint")}
              </Text>
              {orderQuota.exhausted && onUpgradePlan ? (
                <button
                  type="button"
                  onClick={onUpgradePlan}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--p-color-text-link, #005bd3)",
                    cursor: "pointer",
                    font: "inherit",
                    fontWeight: 600,
                    padding: 0,
                    alignSelf: "flex-start",
                  }}
                >
                  {t("home.upgradePlan")}
                </button>
              ) : null}
            </BlockStack>
          </Box>
        ) : orderQuota?.limit == null ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {t("home.orderQuotaUnlimited")}
          </Text>
        ) : null}

        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          {metrics.map((metric) => (
            <AnalyticsMetricCard key={metric.key} metric={metric} />
          ))}
        </InlineGrid>

        {chartLocked ? (
          <Box
            background="bg-surface-secondary"
            borderRadius="200"
            padding="500"
          >
            <BlockStack gap="300" inlineAlign="center">
              <Text as="p" alignment="center" fontWeight="semibold">
                {t("home.chartLockedTitle")}
              </Text>
              <Text as="p" alignment="center" tone="subdued" variant="bodySm">
                {t("home.chartLockedBody")}
              </Text>
              {onUnlockChart ? (
                <button
                  type="button"
                  onClick={onUnlockChart}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--p-color-text-link, #005bd3)",
                    cursor: "pointer",
                    font: "inherit",
                    fontWeight: 600,
                    padding: 0,
                  }}
                >
                  {t("home.upgradePlan")}
                </button>
              ) : null}
            </BlockStack>
          </Box>
        ) : (
          <UsageStatisticsChart series={series} />
        )}
      </BlockStack>
    </div>
  );
}
