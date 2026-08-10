import { isRouteErrorResponse } from "react-router";
import {
  AppProvider,
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineStack,
  Page,
  Text,
} from "@shopify/polaris";
import { AlertCircleIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";

type ErrorInfo = {
  status: number | null;
  message: string;
};

const EMBEDDED_QUERY_KEYS = [
  "shop",
  "host",
  "embedded",
  "id_token",
  "locale",
  "session",
] as const;

function embeddedAppPath(path: string) {
  if (typeof window === "undefined") return path;
  const current = new URLSearchParams(window.location.search);
  const next = new URLSearchParams();
  for (const key of EMBEDDED_QUERY_KEYS) {
    const value = current.get(key);
    if (value) next.set(key, value);
  }
  const qs = next.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

function clearRecoverReloadKeys() {
  if (typeof sessionStorage === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith("billoxi:") && key.includes("reload")) {
        keys.push(key);
      }
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // Ignore storage errors.
  }
}

/** Navigate inside the embedded admin iframe (keeps shop/host params). */
function navigateEmbedded(path: string) {
  const target = embeddedAppPath(path);
  const shopify = (
    window as Window & {
      shopify?: { navigate?: (url: string) => void };
    }
  ).shopify;

  if (typeof shopify?.navigate === "function") {
    shopify.navigate(target);
    return;
  }

  window.location.assign(target);
}

function getErrorInfo(error: unknown): ErrorInfo {
  if (isRouteErrorResponse(error)) {
    const dataMessage =
      typeof error.data === "string"
        ? error.data
        : error.data &&
            typeof error.data === "object" &&
            "message" in error.data &&
            typeof (error.data as { message?: unknown }).message === "string"
          ? (error.data as { message: string }).message
          : "";
    return {
      status: error.status,
      message: dataMessage || error.statusText || "",
    };
  }

  if (error instanceof Error) {
    return { status: null, message: error.message };
  }

  if (typeof error === "string") {
    return { status: null, message: error };
  }

  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const statusText =
      "statusText" in error &&
      typeof (error as { statusText?: unknown }).statusText === "string"
        ? (error as { statusText: string }).statusText
        : "";
    return { status, message: statusText };
  }

  return { status: null, message: "" };
}

function copyForError(info: ErrorInfo): { title: string; description: string } {
  const { status, message } = info;

  if (status === 404) {
    return {
      title: "Page not found",
      description:
        "This page doesn’t exist or may have moved. Go back to Home and try again.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      title: "Access needed",
      description:
        "Your session may have expired, or this store doesn’t have permission for this page. Reload to sign in again.",
    };
  }

  if (status === 200 || /No result found for routeId/i.test(message)) {
    return {
      title: "Couldn’t load this page",
      description:
        "Something interrupted loading. Reload the page. If it still fails, open Home and try again.",
    };
  }

  if (status && status >= 500) {
    return {
      title: "Something went wrong",
      description:
        "We couldn’t load this page right now. Reload to try again. If the problem continues, check back in a few minutes.",
    };
  }

  if (message && !/^\d{3}$/.test(message.trim()) && !/^404\b/i.test(message)) {
    return {
      title: "Something went wrong",
      description: message,
    };
  }

  return {
    title: "Something went wrong",
    description:
      "We couldn’t load this page. Reload to try again, or go back to Home.",
  };
}

export function EmbeddedRouteErrorPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const goHome = () => {
    clearRecoverReloadKeys();
    navigateEmbedded("/app");
  };

  const reload = () => {
    clearRecoverReloadKeys();
    window.location.reload();
  };

  return (
    <AppProvider i18n={enTranslations}>
      <Page title={title}>
        <Card>
          <Box paddingBlock="800" paddingInline="400">
            <BlockStack gap="400" inlineAlign="center">
              <InlineStack align="center">
                <Icon source={AlertCircleIcon} tone="critical" />
              </InlineStack>
              <BlockStack gap="200" inlineAlign="center">
                <Text as="h2" variant="headingMd">
                  {title}
                </Text>
                <Text as="p" tone="subdued" alignment="center">
                  {description}
                </Text>
              </BlockStack>
              <InlineStack gap="300" align="center">
                <Button onClick={goHome}>Go to Home</Button>
                <Button variant="primary" onClick={reload}>
                  Reload page
                </Button>
              </InlineStack>
            </BlockStack>
          </Box>
        </Card>
      </Page>
    </AppProvider>
  );
}

/**
 * Shopify embedded auth bounces sometimes surface as Response status 200
 * with empty body — default ErrorBoundary renders only "200".
 * Also recovers React Router "No result found for routeId …" mismatches.
 * Falls back to a Polaris empty-state style error page.
 */
export function renderEmbeddedRouteError(
  error: unknown,
  reloadKey = "billoxi:route-recover-reload",
) {
  const info = getErrorInfo(error);
  const isRecoverable =
    info.status === 200 || /No result found for routeId/i.test(info.message);

  if (typeof window !== "undefined" && isRecoverable) {
    const last = Number(sessionStorage.getItem(reloadKey) || "0");
    if (Date.now() - last > 4000) {
      sessionStorage.setItem(reloadKey, String(Date.now()));
      window.location.reload();
      return null;
    }
  }

  const copy = copyForError(info);
  return (
    <EmbeddedRouteErrorPage title={copy.title} description={copy.description} />
  );
}

export function renderNotFoundPage() {
  return (
    <EmbeddedRouteErrorPage
      title="Page not found"
      description="This page doesn’t exist or may have moved. Go back to Home and try again."
    />
  );
}
