import type {
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { useEffect, useState } from "react";
import {
  useLoaderData,
  useNavigate,
  useRevalidator,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import {
  AppProvider,
  Badge,
  Banner,
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
import {
  loadNumberSyncFlagsForShop,
  loadSmtpSettingsForShop,
} from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import { loadSetupGuideProgress } from "../setup-guide.server";
import prisma from "../db.server";
import { RecommendedAppsCard } from "../components/recommended-apps";
import { HomeAnalyticsSection } from "../components/home-analytics";
import { DOCUMENT_ACTIVITY_RECORDED_EVENT } from "../record-document-activity.client";
import { getPlanById, planMonthlyPriceLabel } from "../plan-features";
import { planHasCapability } from "../plan-access";
import { loadShopBillingState } from "../billing-plans";
import {
  PlanCrownBadge,
  PlanFeatureBadge,
  PlanLockOverlay,
  usePlanUpgradeModal,
} from "../components/plan-lock";

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
    detail: "Set prefixes and starting numbers for SO, INV, DFT, and RET.",
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

/** Fallback copy when no subscription is active yet. */
const NO_PLAN_SUMMARY = {
  planName: "No plan yet",
  monthlyFee: "—",
  trialDays: 7,
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

const homePagePath = (pathname: string) =>
  pathname.replace(/\/$/, "") || "/app";

export function shouldRevalidate({
  formMethod,
  currentUrl,
  nextUrl,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  if (currentUrl.search !== nextUrl.search) return true;
  // Always refresh analytics when navigating back to Home.
  if (homePagePath(nextUrl.pathname) === "/app") return true;
  return false;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, billing } = await requireAdminAuth(request);
  const shop = session.shop;
  const { hasActivePlan, currentPlanId } = await loadShopBillingState(billing);
  const planId = currentPlanId;
  const canEventLog =
    Boolean(planId) && planHasCapability(planId!, "eventLog");
  const canDashboardChart =
    Boolean(planId) && planHasCapability(planId!, "dashboardChart");
  const activePlan = planId ? getPlanById(planId) : null;
  const planSummary = activePlan
    ? {
        planName: activePlan.name,
        monthlyFee: planMonthlyPriceLabel(activePlan.priceAmount),
        trialDays: activePlan.trialDays,
      }
    : NO_PLAN_SUMMARY;

  const [
    monthlyUsage,
    usageSeries,
    installedAt,
    rawEventLogs,
    syncFlags,
    smtpSettings,
    setupProgress,
  ] = await Promise.all([
    loadShopMonthlyUsage(shop),
    canDashboardChart
      ? loadDailyUsageSeries(shop, 14)
      : Promise.resolve([]),
    loadShopInstalledAt(shop),
    canEventLog
      ? loadRecentDocumentEvents(shop, 15)
      : Promise.resolve([]),
    loadNumberSyncFlagsForShop(shop),
    loadSmtpSettingsForShop(shop),
    loadSetupGuideProgress(shop),
  ]);
  const salesOrderSynced = syncFlags.salesOrder;
  const invoiceSynced = syncFlags.invoice;
  const draftSynced = syncFlags.draft;
  const returnSynced = syncFlags.return;

  const eventLogs = canEventLog
    ? await enrichDocumentEventsWithOrderNames(admin, rawEventLogs)
    : [];

  const trialEndsAt = new Date(installedAt);
  trialEndsAt.setDate(trialEndsAt.getDate() + planSummary.trialDays);

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
    hasActivePlan,
    currentPlanId: planId,
    analytics: {
      printed: monthlyUsage.printed,
      downloaded: monthlyUsage.downloaded,
      sent: monthlyUsage.sent,
      series: usageSeries,
    },
    plan: {
      name: planSummary.planName,
      installedAtLabel: formatInstallDate(installedAt),
      monthlyFee: planSummary.monthlyFee,
      trialEndsAtLabel: formatTrialDate(trialEndsAt),
    },
    eventLogs,
    setupGuide,
  };
};

export default function AppHomePage() {
  const { analytics, plan, eventLogs, setupGuide, hasActivePlan, currentPlanId } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const planIdForLocks = currentPlanId ?? "starter";
  const { guard: planGuard, modal: planUpgradeModal } =
    usePlanUpgradeModal(planIdForLocks);
  const chartUnlocked =
    Boolean(currentPlanId) &&
    planHasCapability(currentPlanId, "dashboardChart");
  const [stepSynced, setStepSynced] = useState(setupGuide.steps);

  useEffect(() => {
    setStepSynced(setupGuide.steps);
  }, [setupGuide.steps]);

  useEffect(() => {
    const refresh = () => {
      if (revalidator.state === "idle") revalidator.revalidate();
    };
    window.addEventListener(DOCUMENT_ACTIVITY_RECORDED_EVENT, refresh);
    return () =>
      window.removeEventListener(DOCUMENT_ACTIVITY_RECORDED_EVENT, refresh);
  }, [revalidator]);

  const planItems = [
    { label: "Your Current Plan", value: plan.name },
    { label: "Date of Your Installation", value: plan.installedAtLabel },
    { label: "Monthly Fee of Your Plan", value: plan.monthlyFee },
    {
      label: "Trial Period Expiration Date",
      value: hasActivePlan ? plan.trialEndsAtLabel : "—",
    },
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

  // Incomplete → open; fully done → stay collapsed (auto-close).
  const [setupOpen, setSetupOpen] = useState(!setupComplete);
  useEffect(() => {
    if (setupComplete) setSetupOpen(false);
  }, [setupComplete]);

  return (
    <AppProvider i18n={enTranslations}>
      <Page
        title=""
        primaryAction={
          hasActivePlan
            ? {
                content: "Sales orders",
                onAction: () => navigate("/app/sales-order"),
              }
            : {
                content: "View pricing",
                onAction: () => navigate("/app/pricing"),
              }
        }
        secondaryActions={
          hasActivePlan
            ? [
                {
                  content: "Templates",
                  onAction: () => navigate("/app/templates"),
                },
                {
                  content: "Settings",
                  onAction: () => navigate("/app/settings"),
                },
              ]
            : undefined
        }
      >
        <Layout>
          {!hasActivePlan ? (
            <Layout.Section>
              <Banner
                title="You’re on FREE"
                tone="info"
                action={{
                  content: "View pricing",
                  onAction: () => navigate("/app/pricing"),
                }}
              >
                <p>
                  Document modules are hidden until you choose STARTER,
                  PREMIUM, or ULTIMATE.
                </p>
              </Banner>
            </Layout.Section>
          ) : null}
          <Layout.Section>
            <BlockStack gap="400">
              {!hasActivePlan ? (
                <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        Setup guide
                      </Text>
                      <PlanCrownBadge label="Paid plan" />
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Setup is locked on FREE. Choose a paid plan to finish
                      store details, templates, numbers, and SMTP.
                    </Text>
                    <Box
                      background="bg-surface-secondary"
                      borderRadius="200"
                      padding="400"
                    >
                      <BlockStack gap="300" inlineAlign="center">
                        <Text as="p" tone="subdued" alignment="center">
                          Unlock Setup guide with STARTER or higher.
                        </Text>
                        <Button
                          variant="primary"
                          onClick={() => navigate("/app/pricing")}
                        >
                          View pricing
                        </Button>
                      </BlockStack>
                    </Box>
                  </BlockStack>
                </Card>
              ) : (
              <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" wrap>
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h2" variant="headingMd">
                            Setup guide
                          </Text>
                          <Badge tone={setupComplete ? "success" : "attention"}>
                            {setupComplete
                              ? "Complete"
                              : `${setupDoneCount}/${setupSteps.length}`}
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {setupComplete
                            ? "All setup steps are done."
                            : "Finish these steps to get Billoxi ready."}
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

                    <ProgressBar
                      progress={setupProgress}
                      size="small"
                      tone="primary"
                    />

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
              )}

              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Plan
                    </Text>
                    <Button
                      variant="plain"
                      onClick={() => navigate("/app/pricing")}
                    >
                      View pricing
                    </Button>
                  </InlineStack>
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
                </BlockStack>
              </Card>

              <Card>
                <HomeAnalyticsSection
                  printed={analytics.printed}
                  downloaded={analytics.downloaded}
                  sent={analytics.sent}
                  series={chartUnlocked ? analytics.series : []}
                  chartLocked={!chartUnlocked}
                  onUnlockChart={() => planGuard("dashboardChart")}
                />
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="fullWidth">
            <PlanLockOverlay
              capability="eventLog"
              currentPlanId={planIdForLocks}
              onUpgrade={() => planGuard("eventLog")}
              lockedFallback={
                <Card padding="0">
                  <Box padding="400">
                    <BlockStack gap="100">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">
                          Event Logs
                        </Text>
                        <PlanFeatureBadge
                          capability="eventLog"
                          currentPlanId={planIdForLocks}
                        />
                      </InlineStack>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Recent print, download, and email activity for sales
                        orders, invoices, credit notes, and packing slips.
                      </Text>
                    </BlockStack>
                  </Box>
                  <Box padding="400" paddingBlockStart="0">
                    <Box
                      background="bg-surface-secondary"
                      borderRadius="200"
                      padding="400"
                    >
                      <Text as="p" tone="subdued" alignment="center">
                        Event log is locked on your plan. Upgrade to ULTIMATE to
                        view activity. New events are not recorded until you
                        upgrade.
                      </Text>
                    </Box>
                  </Box>
                </Card>
              }
            >
            <Card padding="0">
              <Box padding="400">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Event Logs
                    </Text>
                    <PlanFeatureBadge
                      capability="eventLog"
                      currentPlanId={planIdForLocks}
                    />
                  </InlineStack>
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
            </PlanLockOverlay>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <RecommendedAppsCard />
          </Layout.Section>
        </Layout>
      </Page>
      {planUpgradeModal}
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:home-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
