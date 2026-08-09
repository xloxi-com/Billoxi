import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";
import {
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  AppProvider,
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Collapsible,
  Divider,
  Icon,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  ProgressBar,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleChevronRightIcon,
} from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";

import { requireAdminAuth } from "../shopify-context.server";
import {
  loadDailyUsageSeries,
  loadShopMonthlyUsage,
  type DailyUsagePoint,
} from "../shop-monthly-usage.server";
import {
  enrichDocumentEventsWithOrderNames,
  loadRecentDocumentEvents,
} from "../document-event-log.server";
import {
  documentKindLabel,
  formatEventLogTime,
  formatOrderIdLabel,
  orderIdHref,
} from "../document-event-log";
import { hasSalesOrderNumbersSynced } from "../sales-order-number-sync.server";
import { hasInvoiceOrderNumbersSynced } from "../invoice-order-number-sync.server";
import { hasDraftOrderNumbersSynced } from "../draft-order-number-sync.server";
import { hasReturnOrderNumbersSynced } from "../return-order-number-sync.server";
import {
  loadSmtpSettingsForShop,
} from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import { loadSetupGuideProgress } from "../setup-guide.server";
import prisma from "../db.server";
import offrefyLogo from "../assets/recommended/offrefy.png";
import approvefyLogo from "../assets/recommended/approvefy.png";

type SetupStepId =
  | "store-details"
  | "templates"
  | "transaction-numbers"
  | "smtp";

const FULL_SETUP_STEPS: Array<{
  id: SetupStepId;
  label: string;
  detail: string;
  cta: string;
  href: string;
}> = [
  {
    id: "store-details",
    label: "Store details",
    detail: "Add your business name, address, and logo for documents.",
    cta: "Open store details",
    href: "/app/settings?section=store-details",
  },
  {
    id: "templates",
    label: "Document templates",
    detail: "Pick active templates for sales orders and invoices.",
    cta: "Open templates",
    href: "/app/templates",
  },
  {
    id: "transaction-numbers",
    label: "Transaction numbers",
    detail: "Sync SO, INV, DFT, and RET numbers for existing orders.",
    cta: "Open Transaction numbers",
    href: "/app/settings?section=number-series",
  },
  {
    id: "smtp",
    label: "Email (SMTP)",
    detail: "Connect SMTP so you can send documents by email.",
    cta: "Open SMTP settings",
    href: "/app/settings?section=smtp",
  },
];

const CHART_SERIES = [
  { key: "printed" as const, label: "Printed", color: "#2C6ECB" },
  { key: "downloaded" as const, label: "Downloaded", color: "#1A7F64" },
  { key: "sent" as const, label: "Sent", color: "#B98900" },
];

function UsageStatisticsChart({ series }: { series: DailyUsagePoint[] }) {
  const width = 720;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 36, left: 36 };
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
  const groupCount = Math.max(series.length, 1);
  const groupWidth = plotW / groupCount;
  const barGap = 2;
  const barWidth = Math.max(
    3,
    Math.min(14, (groupWidth - 8) / CHART_SERIES.length - barGap),
  );
  const yTicks = [0, 0.5, 1].map((ratio) => Math.round(maxValue * ratio));

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center" wrap>
        <Text as="h3" variant="headingSm">
          Last 14 days
        </Text>
        <InlineStack gap="300" wrap>
          {CHART_SERIES.map((item) => (
            <InlineStack key={item.key} gap="100" blockAlign="center">
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: item.color,
                  display: "inline-block",
                }}
              />
              <Text as="span" variant="bodySm" tone="subdued">
                {item.label}
              </Text>
            </InlineStack>
          ))}
        </InlineStack>
      </InlineStack>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height="220"
          role="img"
          aria-label="Printed, downloaded, and sent activity for the last 14 days"
        >
          {yTicks.map((tick) => {
            const y = pad.top + plotH - (tick / maxValue) * plotH;
            return (
              <g key={`y-${tick}`}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y}
                  y2={y}
                  stroke="#E3E3E3"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#8A8A8A"
                  fontSize={11}
                  fontFamily="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
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
            const showLabel = index % 2 === 0 || index === series.length - 1;

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
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(barH, value > 0 ? 2 : 0)}
                      rx={2}
                      fill={item.color}
                    >
                      <title>
                        {item.label}: {value} on {point.label}
                      </title>
                    </rect>
                  );
                })}
                {showLabel ? (
                  <text
                    x={groupX + groupWidth / 2}
                    y={height - 12}
                    textAnchor="middle"
                    fill="#8A8A8A"
                    fontSize={10}
                    fontFamily="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
                  >
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </BlockStack>
  );
}

const RECOMMENDED_APPS = [
  {
    id: "approvefy",
    name: "Approvefy",
    tagline: "B2B registration & approval",
    href: "https://apps.shopify.com/approvefy",
    badge: "From $4.99/mo",
    logo: approvefyLogo,
  },
  {
    id: "offrefy",
    name: "Offrefy",
    tagline: "Quantity breaks at checkout",
    href: "https://apps.shopify.com/offrefy",
    badge: "Free plan",
    logo: offrefyLogo,
  },
] as const;

/** Placeholder plan until Shopify Billing is wired. */
const PLAN_SUMMARY = {
  planName: "Grow",
  monthlyFee: "$ 9",
  trialDays: 14,
} as const;

function formatInstallDate(value: Date): string {
  return value.toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function formatTrialDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function loadShopInstalledAt(shop: string): Promise<Date> {
  try {
    const settings = await prisma.shopSettings.findUnique({
      where: { shop },
      select: { createdAt: true },
    });
    if (settings?.createdAt) return settings.createdAt;
  } catch {
    // Fall through.
  }
  return new Date();
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await requireAdminAuth(request);
  const shop = session.shop;

  const [
    monthlyUsage,
    usageSeries,
    installedAt,
    rawEventLogs,
    salesOrderSynced,
    invoiceSynced,
    draftSynced,
    returnSynced,
    smtpSettings,
    setupProgress,
  ] = await Promise.all([
    loadShopMonthlyUsage(shop),
    loadDailyUsageSeries(shop, 14),
    loadShopInstalledAt(shop),
    loadRecentDocumentEvents(shop, 15),
    hasSalesOrderNumbersSynced(shop),
    hasInvoiceOrderNumbersSynced(shop),
    hasDraftOrderNumbersSynced(shop),
    hasReturnOrderNumbersSynced(shop),
    loadSmtpSettingsForShop(shop),
    loadSetupGuideProgress(shop),
  ]);

  const eventLogs = await enrichDocumentEventsWithOrderNames(
    admin,
    rawEventLogs,
  );

  const trialEndsAt = new Date(installedAt);
  trialEndsAt.setDate(trialEndsAt.getDate() + PLAN_SUMMARY.trialDays);

  const transactionNumbersReady =
    salesOrderSynced && invoiceSynced && draftSynced && returnSynced;

  // Merchant must finish each step after install — do not treat Shopify
  // auto-filled store details / default templates as Done.
  const setupGuide = {
    steps: {
      "store-details": Boolean(setupProgress["store-details"]),
      templates: Boolean(setupProgress.templates),
      "transaction-numbers": transactionNumbersReady,
      smtp:
        Boolean(setupProgress.smtp) || isSmtpReadyForSend(smtpSettings),
    } satisfies Record<SetupStepId, boolean>,
  };

  return {
    analytics: {
      printed: monthlyUsage.printed,
      downloaded: monthlyUsage.downloaded,
      sent: monthlyUsage.sent,
      series: usageSeries,
    },
    plan: {
      name: PLAN_SUMMARY.planName,
      installedAtLabel: formatInstallDate(installedAt),
      monthlyFee: PLAN_SUMMARY.monthlyFee,
      trialEndsAtLabel: formatTrialDate(trialEndsAt),
    },
    eventLogs,
    setupGuide,
  };
};

export default function AppHomePage() {
  const { analytics, plan, eventLogs, setupGuide } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [setupOpen, setSetupOpen] = useState(true);
  const [stepSynced, setStepSynced] = useState(setupGuide.steps);

  useEffect(() => {
    setStepSynced(setupGuide.steps);
  }, [setupGuide.steps]);

  const planItems = [
    { label: "Your Current Plan", value: plan.name },
    { label: "Date of Your Installation", value: plan.installedAtLabel },
    { label: "Monthly Fee of Your Plan", value: plan.monthlyFee },
    {
      label: "Trial Period Expiration Date",
      value: plan.trialEndsAtLabel,
    },
  ] as const;

  const analyticsItems = [
    { label: "Monthly Printed", value: analytics.printed },
    { label: "Monthly Downloaded", value: analytics.downloaded },
    { label: "Monthly Sent", value: analytics.sent },
  ] as const;

  const setupSteps = FULL_SETUP_STEPS.map((step) => ({
    ...step,
    synced: Boolean(stepSynced[step.id]),
  }));
  const setupDoneCount = setupSteps.filter((step) => step.synced).length;
  const setupComplete = setupDoneCount === setupSteps.length;
  const nextStep = setupSteps.find((step) => !step.synced) ?? null;
  const setupProgress = Math.round(
    (setupDoneCount / setupSteps.length) * 100,
  );

  return (
    <AppProvider i18n={enTranslations}>
      <Page
        title="Home"
        primaryAction={{
          content: "Sales orders",
          onAction: () => navigate("/app/sales-order"),
        }}
        secondaryActions={[
          {
            content: "Templates",
            onAction: () => navigate("/app/templates"),
          },
          {
            content: "Settings",
            onAction: () => navigate("/app/settings"),
          },
        ]}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {!setupComplete ? (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h2" variant="headingMd">
                            Setup guide
                          </Text>
                          <Badge tone="attention">
                            {`${setupDoneCount}/${setupSteps.length}`}
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued" variant="bodySm">
                          Finish these steps to get Billoxi ready.
                        </Text>
                      </BlockStack>
                      <Button
                        variant="plain"
                        icon={setupOpen ? ChevronUpIcon : ChevronDownIcon}
                        accessibilityLabel={
                          setupOpen
                            ? "Collapse setup guide"
                            : "Expand setup guide"
                        }
                        onClick={() => setSetupOpen((open) => !open)}
                      />
                    </InlineStack>

                    <ProgressBar progress={setupProgress} size="small" />

                    <Collapsible
                      open={setupOpen}
                      id="home-full-setup-guide"
                      transition={{
                        duration: "150ms",
                        timingFunction: "ease",
                      }}
                    >
                      <BlockStack gap="0">
                        {setupSteps.map((step, index) => {
                          const isNext = nextStep?.id === step.id;

                          return (
                            <Box key={step.id}>
                              {index > 0 ? <Divider /> : null}
                              <Box
                                padding="300"
                                background={
                                  isNext ? "bg-surface-secondary" : undefined
                                }
                                borderRadius={isNext ? "200" : undefined}
                              >
                                <InlineStack
                                  align="space-between"
                                  blockAlign={isNext ? "start" : "center"}
                                  gap="300"
                                  wrap
                                >
                                  <InlineStack
                                    gap="200"
                                    blockAlign={isNext ? "start" : "center"}
                                    wrap={false}
                                  >
                                    <Box>
                                      <Icon
                                        source={
                                          step.synced
                                            ? CheckCircleIcon
                                            : CircleChevronRightIcon
                                        }
                                        tone={
                                          step.synced
                                            ? "success"
                                            : isNext
                                              ? "base"
                                              : "subdued"
                                        }
                                      />
                                    </Box>
                                    <BlockStack gap="100">
                                      <Text
                                        as="h3"
                                        variant="bodyMd"
                                        fontWeight={
                                          isNext ? "semibold" : undefined
                                        }
                                        tone={
                                          step.synced || isNext
                                            ? undefined
                                            : "subdued"
                                        }
                                      >
                                        {step.label}
                                      </Text>
                                      {isNext ? (
                                        <Text
                                          as="p"
                                          tone="subdued"
                                          variant="bodySm"
                                        >
                                          {step.detail}
                                        </Text>
                                      ) : null}
                                    </BlockStack>
                                  </InlineStack>
                                  {step.synced ? (
                                    <Badge tone="success">Done</Badge>
                                  ) : (
                                    <Button
                                      variant={isNext ? "primary" : "secondary"}
                                      onClick={() => navigate(step.href)}
                                    >
                                      {step.cta}
                                    </Button>
                                  )}
                                </InlineStack>
                              </Box>
                            </Box>
                          );
                        })}
                      </BlockStack>
                    </Collapsible>
                  </BlockStack>
                </Card>
              ) : null}

              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Analytics
                  </Text>
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    {analyticsItems.map((metric) => (
                      <Box
                        key={metric.label}
                        background="bg-surface-secondary"
                        borderRadius="200"
                        padding="400"
                      >
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {metric.label}
                          </Text>
                          <Text as="p" variant="headingLg" fontWeight="bold">
                            {metric.value}
                          </Text>
                        </BlockStack>
                      </Box>
                    ))}
                  </InlineGrid>
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <UsageStatisticsChart series={analytics.series} />
                  </Box>
                </BlockStack>
              </Card>

              <Card>
                <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                  {planItems.map((item) => (
                    <Box
                      key={item.label}
                      background="bg-surface-secondary"
                      borderRadius="200"
                      padding="400"
                    >
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {item.label}
                        </Text>
                        <Text as="p" variant="headingSm" fontWeight="semibold">
                          {item.value}
                        </Text>
                      </BlockStack>
                    </Box>
                  ))}
                </InlineGrid>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="fullWidth">
            <Card padding="0">
              <Box padding="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Event Logs
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Recent print, download, and email activity for sales
                    orders, invoices, credit notes, and packing slips.
                  </Text>
                </BlockStack>
              </Box>

              {eventLogs.length === 0 ? (
                <Box padding="400" paddingBlockStart="0">
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <Text as="p" tone="subdued">
                      No events yet. Print, download, or send a document to see
                      activity here.
                    </Text>
                  </Box>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "event", plural: "events" }}
                  itemCount={eventLogs.length}
                  headings={[
                    { title: "Order ID" },
                    { title: "Description" },
                    { title: "Log Date" },
                  ]}
                  selectable={false}
                >
                  {eventLogs.map((event, index) => {
                    const orderLabel = formatOrderIdLabel(
                      event.orderName,
                      event.orderGid,
                    );
                    const href = orderIdHref(
                      event.orderGid,
                      event.documentKind,
                    );
                    const kindLabel = documentKindLabel(event.documentKind);

                    return (
                      <IndexTable.Row
                        id={event.id}
                        key={event.id}
                        position={index}
                      >
                        <IndexTable.Cell>
                          {href && orderLabel !== "—" ? (
                            <Link
                              removeUnderline
                              onClick={() => navigate(href)}
                            >
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {orderLabel}
                              </Text>
                            </Link>
                          ) : (
                            <Text as="span" tone="subdued">
                              {orderLabel}
                            </Text>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {orderLabel !== "—" ? (
                            <Text as="span" variant="bodyMd">
                              You have {event.action}{" "}
                              <strong>{orderLabel}</strong> as{" "}
                              <strong>
                                {kindLabel === "document"
                                  ? "a document"
                                  : `a ${kindLabel}`}
                              </strong>
                              .
                            </Text>
                          ) : (
                            <Text as="span" variant="bodyMd">
                              {event.message}
                            </Text>
                          )}
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" tone="subdued" variant="bodyMd">
                            {formatEventLogTime(event.createdAt)}
                          </Text>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    More from us
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    Apps that work well alongside Billioxi.
                  </Text>
                </BlockStack>

                <BlockStack gap="300">
                  {RECOMMENDED_APPS.map((app, index) => (
                    <Box key={app.id}>
                      {index > 0 ? <Divider /> : null}
                      <Box paddingBlockStart={index > 0 ? "300" : "0"}>
                        <InlineStack gap="300" blockAlign="start" wrap={false}>
                          <Thumbnail
                            source={app.logo}
                            alt={`${app.name} icon`}
                            size="small"
                          />
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="h3" variant="headingSm">
                                {app.name}
                              </Text>
                              <Badge size="small" tone="info">
                                {app.badge}
                              </Badge>
                            </InlineStack>
                            <Text as="p" tone="subdued" variant="bodySm">
                              {app.tagline}
                            </Text>
                            <Link
                              url={app.href}
                              target="_blank"
                              removeUnderline
                            >
                              View on App Store
                            </Link>
                          </BlockStack>
                        </InlineStack>
                      </Box>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
