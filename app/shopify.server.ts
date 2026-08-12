import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { BILLING_PLAN } from "./billing-plans";
import { BILLIOXI_PLANS, planYearlyTotal } from "./plan-features";

const starter = BILLIOXI_PLANS.find((plan) => plan.id === "starter")!;
const premium = BILLIOXI_PLANS.find((plan) => plan.id === "premium")!;
const ultimate = BILLIOXI_PLANS.find((plan) => plan.id === "ultimate")!;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  // Latest version in @shopify/shopify-api — do not cast unreleased versions.
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  billing: {
    [BILLING_PLAN.starterMonthly]: {
      trialDays: starter.trialDays,
      lineItems: [
        {
          amount: starter.priceAmount,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [BILLING_PLAN.starterYearly]: {
      trialDays: starter.trialDays,
      lineItems: [
        {
          amount: planYearlyTotal(starter.priceAmount),
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
    [BILLING_PLAN.premiumMonthly]: {
      trialDays: premium.trialDays,
      lineItems: [
        {
          amount: premium.priceAmount,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [BILLING_PLAN.premiumYearly]: {
      trialDays: premium.trialDays,
      lineItems: [
        {
          amount: planYearlyTotal(premium.priceAmount),
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
    [BILLING_PLAN.ultimateMonthly]: {
      trialDays: ultimate.trialDays,
      lineItems: [
        {
          amount: ultimate.priceAmount,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
    },
    [BILLING_PLAN.ultimateYearly]: {
      trialDays: ultimate.trialDays,
      lineItems: [
        {
          amount: planYearlyTotal(ultimate.priceAmount),
          currencyCode: "USD",
          interval: BillingInterval.Annual,
        },
      ],
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
