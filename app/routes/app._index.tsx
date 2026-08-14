import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  useFetcher,
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
  Select,
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
  formatEventLogTime,
  formatOrderIdLabel,
  orderIdHref,
} from "../document-event-log";
import {
  loadNumberSyncFlagsForShop,
  loadSmtpSettingsForShop,
} from "../shop-settings.server";
import { isSmtpReadyForSend } from "../smtp-settings";
import { loadSetupGuideProgress, saveAdminLanguage } from "../setup-guide.server";
import {
  ADMIN_UI_LANGUAGES,
  DEFAULT_ADMIN_UI_LANGUAGE,
  adminEventActionLabel,
  adminEventKindLabel,
  adminT,
  adminTf,
  normalizeAdminUiLanguage,
  type AdminUiLanguage,
} from "../admin-i18n";
import { useAdminI18n } from "../admin-i18n-context";
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
  | "admin-language"
  | "store-details"
  | "templates"
  | "transaction-numbers"
  | "smtp";

const FULL_SETUP_STEPS: Array<{
  id: SetupStepId;
  labelKey: import("../admin-i18n").AdminMessageKey;
  detailKey: import("../admin-i18n").AdminMessageKey;
  ctaKey: import("../admin-i18n").AdminMessageKey;
  href: string;
}> = [
  {
    id: "admin-language",
    labelKey: "setup.adminLanguage",
    detailKey: "setup.adminLanguageDetail",
    ctaKey: "setup.saveLanguage",
    href: "/app/settings?section=admin-language",
  },
  {
    id: "store-details",
    labelKey: "setup.storeDetails",
    detailKey: "setup.storeDetailsDetail",
    ctaKey: "setup.openStoreDetails",
    href: "/app/settings?section=store-details",
  },
  {
    id: "templates",
    labelKey: "setup.templates",
    detailKey: "setup.templatesDetail",
    ctaKey: "setup.openTemplates",
    href: "/app/templates",
  },
  {
    id: "transaction-numbers",
    labelKey: "setup.transactionNumbers",
    detailKey: "setup.transactionNumbersDetail",
    ctaKey: "setup.openTransactionNumbers",
    href: "/app/settings?section=number-series",
  },
  {
    id: "smtp",
    labelKey: "setup.smtp",
    detailKey: "setup.smtpDetail",
    ctaKey: "setup.openSmtp",
    href: "/app/settings?section=smtp",
  },
];

const LANGUAGE_OPTIONS = ADMIN_UI_LANGUAGES.map((entry) => ({
  value: entry.value,
  label: entry.label,
}));

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
  const { hasActivePlan, currentPlanId } = await loadShopBillingState(
    billing,
    admin,
  );
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
  const adminLanguage = normalizeAdminUiLanguage(
    setupProgress.adminLanguage,
    DEFAULT_ADMIN_UI_LANGUAGE,
  );
  // New installs must choose language first. Shops that already finished later
  // steps before this feature existed stay complete (default English).
  const adminLanguageDone = Boolean(
    setupProgress["admin-language"] ||
      setupProgress.adminLanguage ||
      setupProgress["store-details"] ||
      setupProgress.templates ||
      setupProgress.smtp,
  );
  const setupGuide = {
    adminLanguage,
    steps: {
      "admin-language": adminLanguageDone,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "save-admin-language") {
    const language = normalizeAdminUiLanguage(
      formData.get("language"),
      DEFAULT_ADMIN_UI_LANGUAGE,
    );
    const progress = await saveAdminLanguage(session.shop, language);
    return {
      ok: true as const,
      intent: "save-admin-language" as const,
      adminLanguage: progress.adminLanguage ?? language,
    };
  }

  return { ok: false as const, error: "Unknown action." };
};

export default function AppHomePage() {
  const { analytics, plan, eventLogs, setupGuide, hasActivePlan, currentPlanId } =
    useLoaderData<typeof loader>();
  const { t, language } = useAdminI18n();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const languageFetcher = useFetcher<typeof action>();
  const planIdForLocks = currentPlanId ?? "starter";
  const { guard: planGuard, modal: planUpgradeModal } =
    usePlanUpgradeModal(planIdForLocks);
  const chartUnlocked =
    Boolean(currentPlanId) &&
    planHasCapability(currentPlanId!, "dashboardChart");
  const [stepSynced, setStepSynced] = useState(setupGuide.steps);
  const [adminLanguage, setAdminLanguage] = useState<AdminUiLanguage>(
    setupGuide.adminLanguage,
  );
  const handledLanguageFetcherRef = useRef<unknown>(null);

  useEffect(() => {
    setStepSynced(setupGuide.steps);
    setAdminLanguage(setupGuide.adminLanguage);
  }, [setupGuide.steps, setupGuide.adminLanguage]);

  useEffect(() => {
    if (languageFetcher.state !== "idle" || !languageFetcher.data) return;
    if (handledLanguageFetcherRef.current === languageFetcher.data) return;
    handledLanguageFetcherRef.current = languageFetcher.data;

    if (
      languageFetcher.data.ok &&
      languageFetcher.data.intent === "save-admin-language"
    ) {
      const nextLanguage = languageFetcher.data.adminLanguage;
      setAdminLanguage(nextLanguage);
      setStepSynced((prev) => ({ ...prev, "admin-language": true }));
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(adminT(nextLanguage, "settings.languageSaved"));
      }
      if (revalidator.state === "idle") revalidator.revalidate();
    } else if (!languageFetcher.data.ok && "error" in languageFetcher.data) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(languageFetcher.data.error || "Could not save", {
          isError: true,
        });
      }
    }
  }, [languageFetcher.state, languageFetcher.data, revalidator]);

  useEffect(() => {
    const refresh = () => {
      if (revalidator.state === "idle") revalidator.revalidate();
    };
    window.addEventListener(DOCUMENT_ACTIVITY_RECORDED_EVENT, refresh);
    return () =>
      window.removeEventListener(DOCUMENT_ACTIVITY_RECORDED_EVENT, refresh);
  }, [revalidator]);

  const planItems = [
    { label: t("home.planCurrent"), value: plan.name },
    { label: t("home.planInstalled"), value: plan.installedAtLabel },
    { label: t("home.planFee"), value: plan.monthlyFee },
    {
      label: t("home.planTrialEnds"),
      value: hasActivePlan ? plan.trialEndsAtLabel : "—",
    },
  ] as const;

  const setupSteps = FULL_SETUP_STEPS.map((step) => ({
    ...step,
    label: t(step.labelKey),
    detail: t(step.detailKey),
    cta: t(step.ctaKey),
    synced: Boolean(stepSynced[step.id]),
  }));
  const setupDoneCount = setupSteps.filter((step) => step.synced).length;
  const setupComplete = setupDoneCount === setupSteps.length;
  const nextStep = setupSteps.find((step) => !step.synced) ?? null;
  const setupProgress = Math.round(
    (setupDoneCount / setupSteps.length) * 100,
  );
  const languageSaving = languageFetcher.state !== "idle";
  const languageDirty = adminLanguage !== setupGuide.adminLanguage;

  const saveAdminLanguageChoice = () => {
    const formData = new FormData();
    formData.set("intent", "save-admin-language");
    formData.set("language", adminLanguage);
    languageFetcher.submit(formData, { method: "post" });
  };

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
                content: t("common.salesOrders"),
                onAction: () => navigate("/app/sales-order"),
              }
            : {
                content: t("common.viewPricing"),
                onAction: () => navigate("/app/pricing"),
              }
        }
        secondaryActions={
          hasActivePlan
            ? [
                {
                  content: t("common.templates"),
                  onAction: () => navigate("/app/templates"),
                },
                {
                  content: t("common.settings"),
                  onAction: () => navigate("/app/settings"),
                },
                {
                  content: t("common.viewPricing"),
                  onAction: () => navigate("/app/pricing"),
                },
              ]
            : undefined
        }
      >
        <Layout>
          {!hasActivePlan ? (
            <Layout.Section>
              <Banner
                title={t("home.freeBannerTitle")}
                tone="info"
                action={{
                  content: t("common.viewPricing"),
                  onAction: () => navigate("/app/pricing"),
                }}
              >
                <p>{t("home.freeBannerBody")}</p>
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
                        {t("setup.guideTitle")}
                      </Text>
                      <PlanCrownBadge label={t("setup.paidPlan")} />
                    </InlineStack>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {t("setup.lockedBody")}
                    </Text>
                    <Box
                      background="bg-surface-secondary"
                      borderRadius="200"
                      padding="400"
                    >
                      <BlockStack gap="300" inlineAlign="center">
                        <Text as="p" tone="subdued" alignment="center">
                          {t("setup.unlockBody")}
                        </Text>
                        <Button
                          variant="primary"
                          onClick={() => navigate("/app/pricing")}
                        >
                          {t("common.viewPricing")}
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
                            {t("setup.guideTitle")}
                          </Text>
                          <Badge tone={setupComplete ? "success" : "attention"}>
                            {setupComplete
                              ? t("setup.complete")
                              : `${setupDoneCount}/${setupSteps.length}`}
                          </Badge>
                        </InlineStack>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {setupComplete
                            ? t("setup.allDone")
                            : t("setup.finishSteps")}
                        </Text>
                      </BlockStack>
                      <Button
                        variant="plain"
                        icon={setupOpen ? ChevronUpIcon : ChevronDownIcon}
                        accessibilityLabel={
                          setupOpen
                            ? t("setup.collapse")
                            : t("setup.expand")
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
                          const isLanguageStep = step.id === "admin-language";
                          // Always show picker so merchants can change language again.
                          const showLanguagePicker = isLanguageStep;

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
                                  blockAlign={
                                    isNext || showLanguagePicker
                                      ? "start"
                                      : "center"
                                  }
                                  gap="300"
                                  wrap
                                >
                                  <InlineStack
                                    gap="200"
                                    blockAlign={
                                      isNext || showLanguagePicker
                                        ? "start"
                                        : "center"
                                    }
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
                                          isNext || isLanguageStep
                                            ? "semibold"
                                            : undefined
                                        }
                                        tone={
                                          step.synced ||
                                          isNext ||
                                          isLanguageStep
                                            ? undefined
                                            : "subdued"
                                        }
                                      >
                                        {step.label}
                                      </Text>
                                      {isNext || showLanguagePicker ? (
                                        <Text
                                          as="p"
                                          tone="subdued"
                                          variant="bodySm"
                                        >
                                          {step.detail}
                                        </Text>
                                      ) : null}
                                      {showLanguagePicker ? (
                                        <Box width="100%">
                                          <div style={{ maxWidth: 320 }}>
                                            <Select
                                              label="Language"
                                              labelHidden
                                              options={LANGUAGE_OPTIONS}
                                              value={adminLanguage}
                                              onChange={(value) =>
                                                setAdminLanguage(
                                                  normalizeAdminUiLanguage(
                                                    value,
                                                  ),
                                                )
                                              }
                                              disabled={languageSaving}
                                            />
                                          </div>
                                        </Box>
                                      ) : null}
                                    </BlockStack>
                                  </InlineStack>
                                  {isLanguageStep ? (
                                    <InlineStack gap="200" blockAlign="center">
                                      {step.synced && !languageDirty ? (
                                        <Badge tone="success">
                                          {t("setup.done")}
                                        </Badge>
                                      ) : null}
                                      <Button
                                        variant={
                                          !step.synced || languageDirty
                                            ? "primary"
                                            : "secondary"
                                        }
                                        onClick={saveAdminLanguageChoice}
                                        loading={languageSaving}
                                        disabled={
                                          languageSaving ||
                                          (step.synced && !languageDirty)
                                        }
                                      >
                                        {step.synced
                                          ? t("setup.updateLanguage")
                                          : step.cta}
                                      </Button>
                                    </InlineStack>
                                  ) : step.synced ? (
                                    <Badge tone="success">{t("setup.done")}</Badge>
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
                      {t("home.plan")}
                    </Text>
                    <Button
                      variant="plain"
                      onClick={() => navigate("/app/pricing")}
                    >
                      {t("common.viewPricing")}
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
                          {t("home.eventLogs")}
                        </Text>
                        <PlanFeatureBadge
                          capability="eventLog"
                          currentPlanId={planIdForLocks}
                        />
                      </InlineStack>
                      <Text as="p" tone="subdued" variant="bodySm">
                        {t("home.eventLogsSubtitle")}
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
                        {t("home.eventLogsLocked")}
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
                      {t("home.eventLogs")}
                    </Text>
                    <PlanFeatureBadge
                      capability="eventLog"
                      currentPlanId={planIdForLocks}
                    />
                  </InlineStack>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("home.eventLogsSubtitle")}
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
                      {t("home.eventLogsEmpty")}
                    </Text>
                  </Box>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: t("home.eventSingular"),
                    plural: t("home.eventPlural"),
                  }}
                  itemCount={eventLogs.length}
                  headings={[
                    { title: t("home.eventOrderId") },
                    { title: t("home.eventDescription") },
                    { title: t("home.eventLogDate") },
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
                    const actionLabel = adminEventActionLabel(
                      language,
                      event.action,
                    );
                    const kindPhrase = adminEventKindLabel(
                      language,
                      event.documentKind,
                    );

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
                              {adminTf(language, "home.eventMessage", {
                                action: actionLabel,
                                order: orderLabel,
                                kind: kindPhrase,
                              })}
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
