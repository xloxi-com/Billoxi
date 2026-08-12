import { AppProvider, Spinner } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

/** Shared full-page / overlay loader — same size as sales-order preview. */
export function PageLoader({
  label = "Loading",
}: {
  label?: string;
}) {
  return (
    <AppProvider i18n={enTranslations}>
      <Spinner accessibilityLabel={label} size="large" />
    </AppProvider>
  );
}
