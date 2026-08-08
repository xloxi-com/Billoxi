import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigate, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  AppProvider,
  Badge,
  BlockStack,
  Box,
  Card,
  Divider,
  IndexTable,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { requireAdminAuth } from "../shopify-context.server";
import { loadShopMonthlyUsage } from "../shop-monthly-usage.server";
import { loadRecentDocumentEvents } from "../document-event-log.server";
import {
  documentKindLabel,
  formatEventLogTime,
  formatOrderIdLabel,
  orderIdHref,
} from "../document-event-log";
import prisma from "../db.server";
import offrefyLogo from "../assets/recommended/offrefy.png";
import approvefyLogo from "../assets/recommended/approvefy.png";

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
  const { session } = await requireAdminAuth(request);
  const shop = session.shop;

  const [monthlyUsage, installedAt, eventLogs] = await Promise.all([
    loadShopMonthlyUsage(shop),
    loadShopInstalledAt(shop),
    loadRecentDocumentEvents(shop, 15),
  ]);

  const trialEndsAt = new Date(installedAt);
  trialEndsAt.setDate(trialEndsAt.getDate() + PLAN_SUMMARY.trialDays);

  return {
    analytics: {
      printed: monthlyUsage.printed,
      downloaded: monthlyUsage.downloaded,
      sent: monthlyUsage.sent,
    },
    plan: {
      name: PLAN_SUMMARY.planName,
      installedAtLabel: formatInstallDate(installedAt),
      monthlyFee: PLAN_SUMMARY.monthlyFee,
      trialEndsAtLabel: formatTrialDate(trialEndsAt),
    },
    eventLogs,
  };
};

export default function AppHomePage() {
  const { analytics, plan, eventLogs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

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
          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
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
