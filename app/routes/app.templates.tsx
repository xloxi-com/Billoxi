import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  PrefetchPageLinks,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import {
  ActionList,
  AppProvider,
  Modal,
  Text,
  Card,
  Button,
  Badge,
  BlockStack,
  InlineStack,
  Box,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  defaultTemplateSettings,
  getSalesOrderTemplatePreset,
  mergeTemplateSettings,
  paperPaddingCss,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
  salesOrderTemplateName,
  type TemplateEditorSettings,
} from "../sales-order-document";
import { sampleSalesOrderForShop, sampleCreditNoteForShop } from "../sales-order-sample";
import { requireAdminAuth } from "../shopify-context.server";
import { resetAllTemplatesToCleanDefaults } from "../sales-order-document.server";
import {
  loadNumberSeriesForShop,
  loadSelectedTemplatesForShop,
  loadStoreDetailsForShop,
  saveSelectedTemplateForShop,
} from "../shop-settings.server";
import {
  numberingFromSeries,
  NUMBER_SERIES_MODULES,
  type NumberSeriesEntry,
  type NumberSeriesMap,
} from "../number-series";
import type { StoreDetails } from "../store-details";
import { emptyStoreDetails } from "../store-details";
import { fetchShopCurrencyCode } from "../store-details.server";
import prisma from "../db.server";
import { PaperScaleFrame } from "../components/paper-scale-frame";
import { templatePreviewLogoDataUrl } from "../template-preview-logo";
import "../templates.css";
import "../template-editor.css";
import "../sales-order-document.css";

const SalesOrderLiveDocument = lazy(() =>
  import("../components/sales-order-live-document").then((mod) => ({
    default: mod.SalesOrderLiveDocument,
  })),
);

type DocumentType = "sales-order" | "invoice" | "credit-note" | "packing-slip";

type Template = {
  id: string;
  name: string;
  description: string;
  accent: string;
  alignment: "left" | "center" | "right";
};

type SalesOrderPreviewBundle = {
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
};

const documentTypes: Array<{
  id: DocumentType;
  label: string;
  description: string;
}> = [
  {
    id: "sales-order",
    label: "Sales Order",
    description: "Choose the layout used for sales orders.",
  },
  {
    id: "invoice",
    label: "Invoice",
    description: "Choose the layout used for invoices.",
  },
  {
    id: "credit-note",
    label: "Credit Note",
    description: "Choose the layout used for credit notes.",
  },
  {
    id: "packing-slip",
    label: "Packing Slip",
    description: "Choose the layout used for packing slips.",
  },
];

const templates: Record<DocumentType, Template[]> = {
  "sales-order": SALES_ORDER_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    accent: preset.accent,
    alignment: preset.alignment,
  })),
  invoice: INVOICE_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    accent: preset.accent,
    alignment: preset.alignment,
  })),
  "credit-note": CREDIT_NOTE_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    accent: preset.accent,
    alignment: preset.alignment,
  })),
  "packing-slip": PACKING_SLIP_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    accent: preset.accent,
    alignment: preset.alignment,
  })),
};

const isDocumentType = (value: string | null): value is DocumentType => {
  return documentTypes.some(({ id }) => id === value);
};

const selectionKey = (documentType: DocumentType) =>
  `invoice-app:selected-template:${documentType}`;

function buildPreviewBundle(args: {
  documentType: "sales-order" | "invoice" | "credit-note" | "packing-slip";
  templateId: string;
  customizationSettings: unknown;
  storeDetails: StoreDetails;
  numberSeries: NumberSeriesEntry;
}): SalesOrderPreviewBundle {
  const templateName = salesOrderTemplateName(args.templateId);
  const defaults = defaultTemplateSettings(templateName, args.templateId);
  const settings = mergeTemplateSettings(
    args.customizationSettings,
    templateName,
    args.templateId,
  );
  settings.numbering = numberingFromSeries(args.numberSeries);
  if (args.storeDetails.name) {
    settings.transactionLabels.organization = args.storeDetails.name;
  }
  if (args.storeDetails.logoDataUrl) {
    settings.logoDataUrl = args.storeDetails.logoDataUrl;
    settings.logoFileName = args.storeDetails.logoFileName;
  }
  // Pin document-type header + repair stale Sales Order titles without loading
  // the full multi-language label packs on the gallery client.
  settings.header = { ...settings.header, ...defaults.header };
  const title = settings.transactionLabels.documentTitle?.trim() ?? "";
  const knownTitles = new Set([
    "SALES ORDER",
    "INVOICE",
    "CREDIT NOTE",
    "PACKING SLIP",
  ]);
  const expected =
    args.documentType === "invoice"
      ? "INVOICE"
      : args.documentType === "credit-note"
        ? "CREDIT NOTE"
        : args.documentType === "packing-slip"
          ? "PACKING SLIP"
          : "SALES ORDER";
  if (knownTitles.has(title) && title !== expected) {
    settings.transactionLabels = {
      ...settings.transactionLabels,
      documentTitle: defaults.transactionLabels.documentTitle,
      orderNumber: defaults.transactionLabels.orderNumber,
      date: defaults.transactionLabels.date,
      reference: defaults.transactionLabels.reference,
    };
  }
  return {
    settings,
    storeDetails: args.storeDetails,
  };
}

/**
 * Fast gallery loader: one Shopify + settings round-trip, raw customizations only.
 * Live A4 card thumbs mount client-side after hydration (avoids SSR timeout /
 * Application Error from rendering ~15 documents on the server).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // Edit is a child outlet — skip heavy gallery I/O on that path.
  if (url.pathname.includes("/templates/edit/")) {
    await requireAdminAuth(request);
    const emptySeries = Object.fromEntries(
      NUMBER_SERIES_MODULES.map((mod) => [mod.id, { ...mod.defaults }]),
    ) as NumberSeriesMap;
    return {
      shopCurrencyCode: "USD",
      selectedTemplates: {} as Record<string, string | null>,
      storeDetails: { ...emptyStoreDetails },
      numberSeries: emptySeries,
      customizationByKey: {} as Record<string, unknown>,
    };
  }

  const { session, admin } = await requireAdminAuth(request);

  try {
    const [selectedTemplates, storeDetails, numberSeries, customizations, shopCurrencyCode] =
      await Promise.all([
        loadSelectedTemplatesForShop(session.shop),
        // Gallery cards use CSS thumbs — skip logo data URL to shrink payload.
        loadStoreDetailsForShop(session.shop, admin, { includeLogo: false }),
        loadNumberSeriesForShop(session.shop),
        (async () => {
          try {
            return await prisma.templateCustomization.findMany({
              where: {
                shop: session.shop,
                documentType: {
                  in: ["sales-order", "invoice", "credit-note", "packing-slip"],
                },
              },
              select: { documentType: true, templateId: true, settings: true },
            });
          } catch (error) {
            console.error("Template customization query failed:", error);
            return [] as Array<{
              documentType: string;
              templateId: string;
              settings: unknown;
            }>;
          }
        })(),
        fetchShopCurrencyCode(admin, session.shop),
      ]);

    const customizationByKey: Record<string, unknown> = {};
    for (const row of customizations) {
      customizationByKey[`${row.documentType}:${row.templateId}`] = row.settings;
    }

    return {
      shopCurrencyCode,
      selectedTemplates,
      storeDetails,
      numberSeries,
      customizationByKey,
    };
  } catch (error) {
    console.error("Templates loader failed:", error);
    throw new Response("Failed to load templates", { status: 500 });
  }
}

export function shouldRevalidate({
  formMethod,
}: {
  formMethod?: string | null;
}) {
  // Gallery only needs to refetch after select-template / reset-all actions.
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  return false;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "reset-all-templates") {
    const result = await resetAllTemplatesToCleanDefaults(session.shop);
    return Response.json({ ok: true, ...result });
  }

  if (intent === "select-template") {
    const documentType = String(formData.get("documentType") || "");
    const templateId = String(formData.get("templateId") || "");
    if (!isDocumentType(documentType) || !templateId) {
      return Response.json(
        { ok: false, error: "Invalid template selection" },
        { status: 400 },
      );
    }

    const available = templates[documentType];
    const isValid = available.some((template) => template.id === templateId);
    if (!isValid) {
      return Response.json(
        { ok: false, error: "Unknown template" },
        { status: 400 },
      );
    }

    const selectedTemplates = await saveSelectedTemplateForShop(
      session.shop,
      documentType,
      templateId,
    );
    return Response.json({ ok: true, selectedTemplates });
  }

  return Response.json({ ok: false, error: "Unknown action" }, { status: 400 });
}

function TemplateThumbnail({ template }: { template: Template }) {
  return (
    <div aria-hidden="true" className="template-card-thumb">
      <div className="template-preview">
        <div
          className="template-preview__sheet"
          style={{
            borderTop: `3px solid ${template.accent}`,
          }}
        >
          <div
            className="template-preview__header"
            style={{ justifyContent: template.alignment === "right" ? "flex-end" : template.alignment === "center" ? "center" : "flex-start" }}
          >
            <div
              className="template-preview__logo"
              style={{ background: template.accent }}
            />
            <div
              className="template-preview__title"
              style={{ color: template.accent, textAlign: template.alignment }}
            >
              {template.name.toUpperCase()}
            </div>
          </div>
          {[68, 90, 76].map((width) => (
            <div
              key={width}
              className="template-preview__line"
              style={{ width: `${width}%` }}
            />
          ))}
          <div
            className="template-preview__table"
            style={{ borderColor: template.accent }}
          >
            {[0, 1, 2].map((row) => (
              <div key={row} className="template-preview__row" />
            ))}
          </div>
          <div
            className="template-preview__total"
            style={{ background: `${template.accent}22` }}
          />
        </div>
      </div>
    </div>
  );
}

function buildPreviewSettings(
  settings: TemplateEditorSettings,
  templateId: string,
  storeLogoDataUrl?: string,
) {
  const preset = getSalesOrderTemplatePreset(templateId);
  const previewSettings: TemplateEditorSettings = {
    ...settings,
    paperSize: "A4",
    orientation: "portrait",
  };

  // Standard stays as saved / classic defaults. Other templates preview with
  // premium finance blocks (paid / due). Tax summary only when the preset opts in.
  if (templateId !== "sales-standard") {
    if (preset.showTaxSummary === true) {
      previewSettings.taxSummary = {
        ...previewSettings.taxSummary,
        enabled: true,
        showTaxableAmount: true,
        showTaxAmount: true,
        showTotalAmount: true,
      };
    } else {
      previewSettings.taxSummary = {
        ...previewSettings.taxSummary,
        enabled: false,
      };
    }
    previewSettings.totals = {
      ...previewSettings.totals,
      showPaidAmount: true,
      showBalanceDue: true,
      paymentStatusStyle: preset.paymentStatusStyle,
    };
    previewSettings.fontFamily = preset.fontFamily || previewSettings.fontFamily;
    previewSettings.backgroundColor =
      preset.backgroundColor || previewSettings.backgroundColor;
    previewSettings.appearance = {
      ...previewSettings.appearance,
      ...preset.appearance,
    };
    previewSettings.logoPosition = preset.logoPosition;
    previewSettings.metaStyle = preset.metaStyle;
  }

  // Prefer shop store logo; otherwise tinted placeholder for gallery cards.
  previewSettings.logoDataUrl =
    storeLogoDataUrl ||
    settings.logoDataUrl ||
    templatePreviewLogoDataUrl(preset.accent);
  previewSettings.header = {
    ...previewSettings.header,
    showLogo: true,
  };

  return previewSettings;
}

function SalesOrderCardThumbnail({
  templateId,
  preview,
  shopCurrencyCode,
}: {
  templateId: string;
  preview: SalesOrderPreviewBundle;
  shopCurrencyCode: string;
}) {
  const previewSettings = buildPreviewSettings(
    preview.settings,
    templateId,
    preview.storeDetails.logoDataUrl,
  );
  const documentNumber = `${previewSettings.numbering.prefix}${previewSettings.numbering.startingNumber}${previewSettings.numbering.suffix ?? ""}`;
  const previewOrder = {
    ...(templateId.startsWith("credit-")
      ? sampleCreditNoteForShop(shopCurrencyCode)
      : sampleSalesOrderForShop(shopCurrencyCode)),
    name: "#1008",
    documentNumber,
  };

  return (
    <div aria-hidden="true" className="template-card-thumb">
      <PaperScaleFrame className="template-card-thumb__scale" fit="contain">
        <div
          className="template-editor__paper template-editor__paper--portrait template-editor__paper--a4 template-card-thumb__paper"
          style={{
            backgroundColor: previewSettings.backgroundColor,
            fontFamily: previewSettings.fontFamily,
            padding: paperPaddingCss(previewSettings.margins),
          }}
        >
          <Suspense fallback={<TemplateThumbnailFallback />}>
            <SalesOrderLiveDocument
              settings={previewSettings}
              templateId={templateId}
              storeDetails={preview.storeDetails}
              showLogoPlaceholder={false}
              order={previewOrder}
            />
          </Suspense>
        </div>
      </PaperScaleFrame>
    </div>
  );
}

function TemplateThumbnailFallback() {
  return (
    <div
      aria-hidden="true"
      style={{
        minHeight: "100%",
        background: "var(--p-color-bg-surface-secondary, #f6f6f7)",
      }}
    />
  );
}

/** Live A4 thumb after hydration + when scrolled into view (keeps gallery fast). */
function DeferredSalesOrderCardThumbnail({
  template,
  preview,
  shopCurrencyCode,
}: {
  template: Template;
  preview: SalesOrderPreviewBundle;
  shopCurrencyCode: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const node = hostRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <div ref={hostRef}>
      {mounted && visible ? (
        <SalesOrderCardThumbnail
          templateId={template.id}
          preview={preview}
          shopCurrencyCode={shopCurrencyCode}
        />
      ) : (
        <TemplateThumbnail template={template} />
      )}
    </div>
  );
}

function SalesOrderTemplatePreview({
  templateId,
  preview,
  shopCurrencyCode,
}: {
  templateId: string;
  preview: SalesOrderPreviewBundle;
  shopCurrencyCode: string;
}) {
  const previewSettings = buildPreviewSettings(
    preview.settings,
    templateId,
    preview.storeDetails.logoDataUrl,
  );
  const documentNumber = `${previewSettings.numbering.prefix}${previewSettings.numbering.startingNumber}${previewSettings.numbering.suffix ?? ""}`;
  const previewOrder = {
    ...(templateId.startsWith("credit-")
      ? sampleCreditNoteForShop(shopCurrencyCode)
      : sampleSalesOrderForShop(shopCurrencyCode)),
    name: "#1008",
    documentNumber,
  };

  return (
    <div className="template-preview-modal__document sales-order-document-stage">
      <PaperScaleFrame key={`${templateId}-a4-portrait`}>
      <div
        className="template-editor__paper template-editor__paper--portrait template-editor__paper--a4"
        style={{
          backgroundColor: previewSettings.backgroundColor,
          fontFamily: previewSettings.fontFamily,
          padding: paperPaddingCss(previewSettings.margins),
        }}
      >
        <Suspense fallback={null}>
          <SalesOrderLiveDocument
            settings={previewSettings}
            templateId={templateId}
            storeDetails={preview.storeDetails}
            showLogoPlaceholder={false}
            order={previewOrder}
          />
        </Suspense>
      </div>
      </PaperScaleFrame>
    </div>
  );
}

export default function TemplatesPage() {
  const {
    shopCurrencyCode,
    selectedTemplates: serverSelectedTemplates,
    storeDetails,
    numberSeries,
    customizationByKey,
  } = useLoaderData<typeof loader>();
  const selectFetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditRoute = location.pathname.includes("/templates/edit/");
  const requestedType = searchParams.get("type");
  const [activeType, setActiveType] = useState<DocumentType>(
    isDocumentType(requestedType) ? requestedType : "sales-order",
  );
  const activeDocument =
    documentTypes.find(({ id }) => id === activeType) ?? documentTypes[0];
  const [selectedTemplates, setSelectedTemplates] = useState<
    Partial<Record<DocumentType, string>>
  >({});
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<Template | null>(null);

  // Live card thumbs for the visible document type only (~15, not all 60).
  // Cards mount via IntersectionObserver so first paint stays light.
  const salesOrderPreviews = useMemo(() => {
    if (isEditRoute) return {} as Record<string, SalesOrderPreviewBundle>;
    const series = numberSeries as NumberSeriesMap;
    const next: Record<string, SalesOrderPreviewBundle> = {};
    for (const template of templates[activeType]) {
      next[template.id] = buildPreviewBundle({
        documentType: activeType,
        templateId: template.id,
        customizationSettings:
          customizationByKey[`${activeType}:${template.id}`] ?? null,
        storeDetails,
        numberSeries: series[activeType],
      });
    }
    return next;
  }, [
    activeType,
    customizationByKey,
    isEditRoute,
    numberSeries,
    storeDetails,
  ]);

  const salesOrderPreviewBundle = useMemo(() => {
    if (!previewTemplate) return null;
    return salesOrderPreviews[previewTemplate.id] ?? null;
  }, [previewTemplate, salesOrderPreviews]);

  useEffect(() => {
    const savedSelections: Partial<Record<DocumentType, string>> = {};

    documentTypes.forEach(({ id }) => {
      const available = templates[id];
      const firstTemplateId = available[0]?.id;
      if (!firstTemplateId) return;

      const serverTemplate = serverSelectedTemplates[id];
      const isValidServer = available.some(
        (template) => template.id === serverTemplate,
      );
      const localTemplate = window.localStorage.getItem(selectionKey(id));
      const isValidLocal = available.some(
        (template) => template.id === localTemplate,
      );

      // Shop DB selection wins; localStorage is only a fallback / mirror.
      const selectedId = isValidServer
        ? serverTemplate!
        : isValidLocal
          ? localTemplate!
          : firstTemplateId;

      window.localStorage.setItem(selectionKey(id), selectedId);
      savedSelections[id] = selectedId;

      // Migrate browser-only Active badge into shop settings once.
      if (!isValidServer && isValidLocal && localTemplate) {
        const formData = new FormData();
        formData.set("intent", "select-template");
        formData.set("documentType", id);
        formData.set("templateId", localTemplate);
        selectFetcher.submit(formData, { method: "post" });
      }
    });

    setSelectedTemplates(savedSelections);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only rehydrate when server map changes
  }, [serverSelectedTemplates]);

  useEffect(() => {
    if (!previewTemplate) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewTemplate(null);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewTemplate]);

  const changeDocumentType = (documentType: DocumentType) => {
    setActiveType(documentType);

    const url = new URL(window.location.href);
    url.searchParams.set("type", documentType);
    window.history.replaceState(window.history.state, "", url);
  };

  const selectTemplate = (templateId: string) => {
    window.localStorage.setItem(selectionKey(activeType), templateId);
    setSelectedTemplates((current) => ({
      ...current,
      [activeType]: templateId,
    }));

    const formData = new FormData();
    formData.set("intent", "select-template");
    formData.set("documentType", activeType);
    formData.set("templateId", templateId);
    selectFetcher.submit(formData, { method: "post" });
  };

  const confirmUseTemplate = () => {
    if (!confirmTemplate) return;
    selectTemplate(confirmTemplate.id);
    setConfirmTemplate(null);
  };

  if (isEditRoute) {
    return <Outlet />;
  }

  const salesOrderPreview = salesOrderPreviewBundle;

  return (
    <AppProvider i18n={enTranslations}>
    <div className="templates-polaris-shell">
    <s-page heading="Templates" inlineSize="large">
      <div className="templates-page">
        <s-stack direction="block" gap="base">
          <div className="templates-content__header">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">
                {activeDocument.label} templates
              </Text>
              <Text as="p" tone="subdued">
                {activeDocument.description}
              </Text>
            </BlockStack>
            <Badge tone="info">
              {`${templates[activeType].length} available`}
            </Badge>
          </div>

          <div className="templates-layout">
            <div className="templates-sidebar">
              <Card padding="0">
                <Box paddingBlockStart="300" paddingInline="300" paddingBlockEnd="100">
                  <Text as="h3" variant="headingSm">
                    Document type
                  </Text>
                </Box>
                <ActionList
                  actionRole="menuitem"
                  items={documentTypes.map((documentType) => ({
                    content: documentType.label,
                    active: documentType.id === activeType,
                    onAction: () => changeDocumentType(documentType.id),
                  }))}
                />
              </Card>
            </div>

            <div className="templates-content">
              <s-stack direction="block" gap="base">
                <div className="templates-grid">
                  {templates[activeType].map((template) => {
                    const isSelected =
                      selectedTemplates[activeType] === template.id;
                    const livePreview = salesOrderPreviews[template.id] ?? null;

                    return (
                      <div className="template-card" key={template.id}>
                        <Card padding="0" background="bg-surface">
                          <div className="template-card__inner">
                            {livePreview ? (
                              <DeferredSalesOrderCardThumbnail
                                template={template}
                                preview={livePreview}
                                shopCurrencyCode={shopCurrencyCode}
                              />
                            ) : (
                              <TemplateThumbnail template={template} />
                            )}
                            <Box padding="400">
                              <BlockStack gap="300">
                                <InlineStack gap="200" blockAlign="center" wrap={false}>
                                  <Text as="h3" variant="headingSm">
                                    {template.name}
                                  </Text>
                                  {isSelected ? (
                                    <Badge tone="success">Active</Badge>
                                  ) : null}
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  <span className="template-card__description">
                                    {template.description}
                                  </span>
                                </Text>
                                <div className="template-card__actions">
                                  <Button
                                    onClick={() => setPreviewTemplate(template)}
                                  >
                                    Preview
                                  </Button>
                                  {isSelected ? (
                                    <>
                                      <PrefetchPageLinks
                                        page={`/app/templates/edit/${activeType}/${template.id}`}
                                      />
                                      <Button
                                        variant="secondary"
                                        onClick={() =>
                                          navigate(
                                            `/app/templates/edit/${activeType}/${template.id}`,
                                          )
                                        }
                                      >
                                        Edit template
                                      </Button>
                                    </>
                                  ) : (
                                    <Button
                                      variant="primary"
                                      onClick={() => setConfirmTemplate(template)}
                                    >
                                      Use template
                                    </Button>
                                  )}
                                </div>
                              </BlockStack>
                            </Box>
                          </div>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </s-stack>
            </div>
          </div>
        </s-stack>
      </div>
      <Modal
        open={confirmTemplate !== null}
        onClose={() => setConfirmTemplate(null)}
        title="Use this template?"
        primaryAction={{
          content: "Yes",
          onAction: confirmUseTemplate,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmTemplate(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {confirmTemplate
              ? `Use “${confirmTemplate.name}” as your active ${activeDocument.label} template?`
              : "Use this template?"}
          </Text>
        </Modal.Section>
      </Modal>
      {previewTemplate ? (
        <div
          className="template-preview-modal__backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewTemplate(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="template-preview-title"
            aria-modal="true"
            className={`template-preview-modal${
              salesOrderPreview ? " template-preview-modal--document" : ""
            }`}
            role="dialog"
          >
            <div className="template-preview-modal__header">
              <div>
                <s-heading id="template-preview-title">
                  {previewTemplate.name}
                </s-heading>
                <s-paragraph color="subdued">
                  {activeDocument.label} template preview
                </s-paragraph>
              </div>
              <button
                aria-label="Close preview"
                className="template-preview-modal__close"
                onClick={() => setPreviewTemplate(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="template-preview-modal__preview">
              {salesOrderPreview ? (
                <SalesOrderTemplatePreview
                  templateId={previewTemplate.id}
                  preview={salesOrderPreview}
                  shopCurrencyCode={shopCurrencyCode}
                />
              ) : (
                <TemplateThumbnail template={previewTemplate} />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </s-page>
    </div>
    </AppProvider>
  );
}
