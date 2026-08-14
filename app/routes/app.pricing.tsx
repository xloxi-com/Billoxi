import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useLoaderData,
  useNavigation,
  useRouteError,
  useRouteLoaderData,
  useSubmit,
  useActionData,
} from "react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BillingReplacementBehavior,
  boundary,
} from "@shopify/shopify-app-react-router/server";
import {
  AppProvider,
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  DataTable,
  Icon,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";

import { requireAdminAuth } from "../shopify-context.server";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import {
  billingPlanName,
  clearShopBillingStateCache,
  isBillingPeriod,
  isPlanId,
  shouldUseTestBillingCharge,
  loadShopBillingState,
  type BillingPeriod,
} from "../billing-plans";
import {
  BILLIOXI_PLANS,
  PLAN_COMPARISON_ROWS,
  PLAN_USAGE_COUNTS,
  PLAN_USAGE_NOT_COUNTED,
  YEARLY_DISCOUNT_PERCENT,
  formatUsd,
  planYearlyPriceLabel,
  planYearlyMonthlyEquivalent,
  planCtaKind,
  type PlanId,
} from "../plan-features";
import {
  pricingT,
  pricingTf,
  pricingHighlight,
  pricingFeature,
  pricingValue,
  pricingUsageAction,
  pricingUsageCount,
  pricingUsageFree,
  pricingPlanCtaLabel,
} from "../admin-pricing-i18n";
import { useAdminI18n } from "../admin-i18n-context";
import type { loader as appLoader } from "./app";

/** Static catalog only — billing status comes from parent `routes/app` loader. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAdminAuth(request);
  return {
    plans: BILLIOXI_PLANS,
    comparisonRows: PLAN_COMPARISON_ROWS,
    yearlyDiscountPercent: YEARLY_DISCOUNT_PERCENT,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session, redirect } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "subscribe");
  const isTest = await shouldUseTestBillingCharge(admin);

  if (intent === "downgrade-free") {
    try {
      clearShopBillingStateCache(billing);
      const { hasActivePlan, activeSubscriptionId, appSubscriptions } =
        await loadShopBillingState(billing);

      const subscriptionId =
        activeSubscriptionId || appSubscriptions[0]?.id || null;

      if (hasActivePlan && subscriptionId) {
        await billing.cancel({
          subscriptionId,
          isTest,
          prorate: true,
        });
      }

      clearShopBillingStateCache(billing);
      // Back to plan picker (FREE gate).
      return redirect("/app/pricing");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not downgrade to FREE.";
      return Response.json(
        { ok: false, intent: "downgrade-free", error: message },
        { status: 400 },
      );
    }
  }

  const planIdRaw = formData.get("planId");
  const periodRaw = formData.get("period");

  if (!isPlanId(planIdRaw) || !isBillingPeriod(periodRaw)) {
    return Response.json(
      { ok: false, error: "Invalid plan or billing period." },
      { status: 400 },
    );
  }

  clearShopBillingStateCache(billing);
  const plan = billingPlanName(planIdRaw, periodRaw);
  const storeHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  // After Shopify approves the charge, land on Home (Billoxi).
  const returnUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${apiKey}/app`;

  return billing.request({
    plan,
    isTest,
    returnUrl,
    replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
  });
};

function PlanValue({
  value,
  language,
}: {
  value: string;
  language: string;
}) {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  const display = pricingValue(language, trimmed);

  let content: ReactNode;

  if (normalized === "no") {
    content = (
      <span title={display} aria-label={display}>
        <Icon source={XCircleIcon} tone="critical" />
      </span>
    );
  } else if (normalized === "yes") {
    content = (
      <span title={display} aria-label={display}>
        <Icon source={CheckCircleIcon} tone="success" />
      </span>
    );
  } else if (normalized.startsWith("yes ")) {
    // e.g. "Yes (all 6 types)" — prefer full translation when available.
    content = (
      <InlineStack gap="100" blockAlign="center" wrap={false} align="center">
        <span title={display} aria-label={display}>
          <Icon source={CheckCircleIcon} tone="success" />
        </span>
        <Text as="span" variant="bodySm" tone="subdued">
          {display}
        </Text>
      </InlineStack>
    );
  } else {
    content = (
      <Text as="span" fontWeight="semibold">
        {display}
      </Text>
    );
  }

  return <div className="pricing-plan-value">{content}</div>;
}

export default function PricingPage() {
  const { plans, comparisonRows, yearlyDiscountPercent } =
    useLoaderData<typeof loader>();
  const { language } = useAdminI18n();
  const appData = useRouteLoaderData<typeof appLoader>("routes/app");
  const hasActivePlan = Boolean(appData?.hasActivePlan);
  const currentPlanId = (appData?.currentPlanId ?? null) as PlanId | null;
  const actionData = useActionData() as
    | { ok: false; intent?: string; error?: string }
    | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>("monthly");
  const [subscribingPlanId, setSubscribingPlanId] = useState<PlanId | null>(
    null,
  );
  const handledActionDataRef = useRef<unknown>(null);

  const isDowngradingFree =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "downgrade-free";
  const isSubscribing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "subscribe";

  useEffect(() => {
    if (navigation.state === "idle") {
      setSubscribingPlanId(null);
    }
  }, [navigation.state]);

  useEffect(() => {
    if (navigation.state !== "idle" || !actionData) return;
    if (handledActionDataRef.current === actionData) return;
    handledActionDataRef.current = actionData;
    if (
      "ok" in actionData &&
      actionData.ok === false &&
      typeof shopify !== "undefined" &&
      shopify.toast
    ) {
      shopify.toast.show(
        "error" in actionData && typeof actionData.error === "string"
          ? actionData.error
          : "Could not update plan.",
        { isError: true },
      );
    }
  }, [navigation.state, actionData]);

  const comparisonTableRows = comparisonRows.map((row) => [
    pricingFeature(language, row.feature),
    <PlanValue
      key={`s-${row.feature}`}
      value={row.starter}
      language={language}
    />,
    <PlanValue
      key={`p-${row.feature}`}
      value={row.premium}
      language={language}
    />,
    <PlanValue
      key={`u-${row.feature}`}
      value={row.ultimate}
      language={language}
    />,
  ]);

  const requestPlan = (planId: PlanId) => {
    setSubscribingPlanId(planId);
    submit(
      {
        intent: "subscribe",
        planId,
        period: billingPeriod,
      },
      { method: "post" },
    );
  };

  const downgradeToFree = () => {
    if (!hasActivePlan || isDowngradingFree) return;
    submit({ intent: "downgrade-free" }, { method: "post" });
  };

  return (
    <AppProvider i18n={enTranslations}>
      <Page
        title={pricingT(language, "pricing.title")}
        subtitle={
          hasActivePlan
            ? pricingT(language, "pricing.subtitleActive")
            : pricingT(language, "pricing.subtitleFree")
        }
      >
        <Layout>
          <Layout.Section>
            <InlineStack align="center">
              <ButtonGroup variant="segmented">
                <Button
                  pressed={billingPeriod === "monthly"}
                  onClick={() => setBillingPeriod("monthly")}
                >
                  {pricingT(language, "pricing.monthly")}
                </Button>
                <Button
                  pressed={billingPeriod === "yearly"}
                  onClick={() => setBillingPeriod("yearly")}
                >
                  {pricingTf(language, "pricing.yearlySave", {
                    percent: String(yearlyDiscountPercent),
                  })}
                </Button>
              </ButtonGroup>
            </InlineStack>
          </Layout.Section>

          <Layout.Section>
            <div className="pricing-plan-cards">
              {plans.map((plan) => {
                const isYearly = billingPeriod === "yearly";
                const isPremium = plan.id === "premium";
                const ctaKind = planCtaKind(plan.id, currentPlanId);
                const isCurrent = ctaKind === "current";
                const monthlyLabel = pricingTf(language, "pricing.pricePerMo", {
                  price: formatUsd(
                    isYearly
                      ? planYearlyMonthlyEquivalent(plan.priceAmount)
                      : plan.priceAmount,
                  ),
                });

                return (
                  <div key={plan.id} className="pricing-plan-card-wrap">
                    <Card>
                      <div className="pricing-plan-card">
                        <div className="pricing-plan-card__body">
                          <BlockStack gap="400">
                            <BlockStack gap="200" inlineAlign="center">
                              {isPremium ? (
                                <Badge tone="info">
                                  {pricingT(language, "pricing.mostPopular")}
                                </Badge>
                              ) : (
                                <div className="pricing-plan-card__badge-spacer" />
                              )}
                              <Text
                                as="h2"
                                variant="headingMd"
                                alignment="center"
                              >
                                {plan.name}
                              </Text>
                              <Text
                                as="p"
                                variant="headingXl"
                                alignment="center"
                                fontWeight="bold"
                              >
                                {monthlyLabel}
                              </Text>
                              <Text
                                as="p"
                                tone="subdued"
                                variant="bodySm"
                                alignment="center"
                              >
                                {isYearly
                                  ? pricingTf(
                                      language,
                                      "pricing.yearlyBilledSave",
                                      {
                                        price: planYearlyPriceLabel(
                                          plan.priceAmount,
                                        ),
                                        percent: String(yearlyDiscountPercent),
                                      },
                                    )
                                  : pricingT(language, "pricing.billedMonthly")}
                              </Text>
                              <Text
                                as="p"
                                tone="subdued"
                                variant="bodySm"
                                alignment="center"
                              >
                                {pricingTf(language, "pricing.trialDays", {
                                  days: String(plan.trialDays),
                                })}
                              </Text>
                            </BlockStack>

                            <BlockStack gap="200">
                              {plan.highlights.map((item) => (
                                <InlineStack
                                  key={item}
                                  gap="200"
                                  blockAlign="start"
                                  wrap={false}
                                >
                                  <span className="pricing-plan-card__check">
                                    <Icon
                                      source={CheckCircleIcon}
                                      tone="success"
                                    />
                                  </span>
                                  <Text as="p" variant="bodySm" alignment="start">
                                    {pricingHighlight(language, item)}
                                  </Text>
                                </InlineStack>
                              ))}
                            </BlockStack>
                          </BlockStack>
                        </div>

                        <div className="pricing-plan-card__cta">
                          <Button
                            fullWidth
                            variant={
                              ctaKind === "upgrade" || isPremium
                                ? "primary"
                                : "secondary"
                            }
                            disabled={isCurrent || isDowngradingFree}
                            loading={
                              isSubscribing && subscribingPlanId === plan.id
                            }
                            onClick={() => {
                              if (isCurrent) return;
                              requestPlan(plan.id);
                            }}
                          >
                            {pricingPlanCtaLabel(
                              language,
                              plan.id,
                              currentPlanId,
                            )}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>

            <div className="pricing-free-row">
              <Card>
                <div className="pricing-free-row__inner">
                  <BlockStack gap="100">
                    <Text as="h2" variant="headingMd">
                      {pricingT(language, "pricing.freeTitle")}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {pricingT(language, "pricing.freeDesc")}
                    </Text>
                  </BlockStack>
                  <div className="pricing-free-row__cta">
                    <Button
                      variant="secondary"
                      disabled={!hasActivePlan || isSubscribing}
                      loading={isDowngradingFree}
                      onClick={downgradeToFree}
                    >
                      {hasActivePlan
                        ? pricingT(language, "pricing.ctaDowngrade")
                        : pricingT(language, "pricing.ctaCurrent")}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>

            <style>{`
              .pricing-plan-cards {
                display: grid;
                grid-template-columns: 1fr;
                gap: 16px;
                align-items: stretch;
              }
              @media (min-width: 768px) {
                .pricing-plan-cards {
                  grid-template-columns: repeat(3, 1fr);
                }
              }
              .pricing-free-row {
                margin-top: 16px;
              }
              .pricing-free-row__inner {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
              }
              .pricing-free-row__inner > *:first-child {
                min-width: 0;
                flex: 1 1 auto;
              }
              .pricing-free-row__cta {
                flex: 0 0 auto;
              }
              @media (max-width: 600px) {
                .pricing-free-row__inner {
                  flex-direction: column;
                  align-items: stretch;
                }
                .pricing-free-row__cta .Polaris-Button {
                  width: 100%;
                }
              }
              .pricing-plan-card-wrap,
              .pricing-plan-card-wrap > .Polaris-ShadowBevel,
              .pricing-plan-card-wrap .Polaris-Box {
                height: 100%;
              }
              .pricing-plan-card {
                display: flex;
                flex-direction: column;
                text-align: center;
                height: 100%;
                box-sizing: border-box;
              }
              .pricing-plan-card__body {
                flex: 1 1 auto;
                text-align: left;
              }
              .pricing-plan-card__cta {
                margin-top: auto;
                padding-top: 16px;
              }
              .pricing-plan-card__badge-spacer {
                height: 20px;
              }
              .pricing-plan-card__check {
                flex: 0 0 auto;
                margin-top: 1px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                min-width: 20px;
                min-height: 20px;
                line-height: 0;
                overflow: hidden;
              }
              .pricing-plan-card__check .Polaris-Icon,
              .pricing-plan-card__check .Polaris-Icon--colorSuccess {
                margin: 0 !important;
                width: 20px !important;
                height: 20px !important;
                max-width: 20px !important;
                max-height: 20px !important;
              }
              .pricing-plan-card__check .Polaris-Icon svg,
              .pricing-plan-card__check svg {
                width: 20px !important;
                height: 20px !important;
                max-width: 20px !important;
                max-height: 20px !important;
                display: block;
              }
              .pricing-plan-value .Polaris-Icon {
                margin: 0 !important;
                width: 20px !important;
                height: 20px !important;
              }
              .pricing-plan-value .Polaris-Icon svg,
              .pricing-plan-value svg {
                width: 20px !important;
                height: 20px !important;
                display: block;
              }
            `}</style>
          </Layout.Section>

          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {pricingT(language, "pricing.featuresTitle")}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {pricingT(language, "pricing.featuresSubtitle")}
                  </Text>
                </BlockStack>
              </Box>
              <div className="pricing-features-table">
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={[
                    pricingT(language, "pricing.featureCol"),
                    <div key="h-starter" className="pricing-plan-heading">
                      STARTER
                    </div>,
                    <div key="h-premium" className="pricing-plan-heading">
                      <InlineStack gap="100" blockAlign="center" align="center" wrap={false}>
                        <span>PREMIUM</span>
                        <Badge tone="info" size="small">
                          {pricingT(language, "pricing.mostPopular")}
                        </Badge>
                      </InlineStack>
                    </div>,
                    <div key="h-ultimate" className="pricing-plan-heading">
                      ULTIMATE
                    </div>,
                  ]}
                  rows={comparisonTableRows}
                  increasedTableDensity
                  stickyHeader
                />
              </div>
              <style>{`
                .pricing-features-table .Polaris-DataTable__Cell:nth-child(n + 2),
                .pricing-features-table .Polaris-DataTable__Cell--header:nth-child(n + 2),
                .pricing-features-table th:nth-child(n + 2),
                .pricing-features-table td:nth-child(n + 2) {
                  text-align: center !important;
                }
                .pricing-features-table th:nth-child(n + 2) .Polaris-DataTable__Heading,
                .pricing-features-table td:nth-child(n + 2) > * {
                  margin-left: auto;
                  margin-right: auto;
                }
                .pricing-plan-heading,
                .pricing-plan-value {
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  width: 100%;
                  text-align: center;
                }
              `}</style>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {pricingT(language, "pricing.howOrdersTitle")}
                  </Text>
                  <Text as="p" tone="subdued">
                    {pricingT(language, "pricing.howOrdersDesc")}
                  </Text>
                </BlockStack>

                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">
                        {pricingT(language, "pricing.countsToward")}
                      </Text>
                      <BlockStack gap="200">
                        {PLAN_USAGE_COUNTS.map((row) => (
                          <InlineStack
                            key={row.action}
                            align="space-between"
                            blockAlign="center"
                            gap="300"
                            wrap={false}
                          >
                            <Text as="p">
                              {pricingUsageAction(language, row.action)}
                            </Text>
                            <Text as="p" tone="subdued" variant="bodySm">
                              {pricingUsageCount(language, row.count)}
                            </Text>
                          </InlineStack>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  </Box>

                  <Box
                    background="bg-surface-secondary"
                    borderRadius="200"
                    padding="400"
                  >
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">
                        {pricingT(language, "pricing.neverCounted")}
                      </Text>
                      <BlockStack gap="200">
                        {PLAN_USAGE_NOT_COUNTED.map((item) => (
                          <Text key={item} as="p">
                            {pricingUsageFree(language, item)}
                          </Text>
                        ))}
                      </BlockStack>
                    </BlockStack>
                  </Box>
                </InlineGrid>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:pricing-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
