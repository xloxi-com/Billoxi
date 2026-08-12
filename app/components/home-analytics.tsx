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

import "./home-analytics.css";

type AnalyticsMetric = {
  key: "printed" | "downloaded" | "sent";
  label: string;
  value: number;
};

const CHART_SERIES = [
  {
    key: "printed" as const,
    label: "Printed",
    cssVar: "--billoxi-analytics-printed",
  },
  {
    key: "downloaded" as const,
    label: "Downloaded",
    cssVar: "--billoxi-analytics-downloaded",
  },
  {
    key: "sent" as const,
    label: "Sent",
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
    Math.min(12, (groupWidth - 10) / CHART_SERIES.length - barGap),
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
              Last 14 days
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Print, download, and email activity
            </Text>
          </BlockStack>
          <InlineStack gap="300" wrap>
            {CHART_SERIES.map((item) => (
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
              No activity in the last 14 days. Print, download, or send a
              document to see trends here.
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
              aria-label="Printed, downloaded, and sent activity for the last 14 days"
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
                  CHART_SERIES.length * barWidth +
                  (CHART_SERIES.length - 1) * barGap;
                const startX = groupX + (groupWidth - clusterWidth) / 2;
                const showLabel =
                  index % 2 === 0 || index === series.length - 1;

                return (
                  <g key={point.date}>
                    {CHART_SERIES.map((item, barIndex) => {
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
};

export function HomeAnalyticsSection({
  printed,
  downloaded,
  sent,
  series,
  chartLocked = false,
  onUnlockChart,
}: HomeAnalyticsProps) {
  const metrics: AnalyticsMetric[] = [
    { key: "printed", label: "Monthly Printed", value: printed },
    { key: "downloaded", label: "Monthly Downloaded", value: downloaded },
    { key: "sent", label: "Monthly Sent", value: sent },
  ];

  return (
    <div className="billoxi-analytics">
      <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant="headingMd">
          Analytics
        </Text>
        <Text as="p" tone="subdued" variant="bodySm">
          Document activity for the current calendar month
        </Text>
      </BlockStack>

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
              Usage chart — PREMIUM
            </Text>
            <Text as="p" alignment="center" tone="subdued" variant="bodySm">
              Upgrade to unlock the last 14 days activity chart.
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
                Upgrade plan
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
