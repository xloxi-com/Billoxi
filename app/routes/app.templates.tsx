import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";
import { AppProvider, Modal, Text, Card, Button, Badge, BlockStack, InlineStack, Box } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import { SalesOrderLiveDocument } from "../components/sales-order-live-document";
import {
  DEFAULT_SALES_ORDER_TEMPLATE_ID,
  getSalesOrderTemplatePreset,
  paperPaddingCss,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  type TemplateEditorSettings,
} from "../sales-order-document";
import { sampleSalesOrderForShop } from "../sales-order-sample";
import {
  loadDocumentTemplateSettings,
  loadSalesOrderTemplateSettings,
  resetAllTemplatesToCleanDefaults,
} from "../sales-order-document.server";
import { requireAdminAuth } from "../shopify-context.server";
import {
  loadSelectedTemplatesForShop,
  saveSelectedTemplateForShop,
} from "../shop-settings.server";
import type { StoreDetails } from "../store-details";
import { fetchShopCurrencyCode } from "../store-details.server";
import { PaperScaleFrame } from "../components/paper-scale-frame";
import { templatePreviewLogoDataUrl } from "../template-preview-logo";
import "../templates.css";
import "../template-editor.css";
import "../sales-order-document.css";

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
  "credit-note": [
    {
      id: "credit-standard",
      name: "Standard",
      description: "A clear layout for refunds and adjustments.",
      accent: "#d72c0d",
      alignment: "left",
    },
    {
      id: "credit-detailed",
      name: "Detailed",
      description: "Includes extra space for adjustment notes.",
      accent: "#8e4b10",
      alignment: "right",
    },
    {
      id: "credit-simple",
      name: "Simple",
      description: "A lightweight credit note layout.",
      accent: "#2c6ecb",
      alignment: "center",
    },
    {
      id: "credit-compact",
      name: "Compact",
      description: "A concise layout for quick adjustments.",
      accent: "#6d3f8f",
      alignment: "left",
    },
  ],
  "packing-slip": [
    {
      id: "packing-standard",
      name: "Standard",
      description: "A clear packing slip for everyday shipments.",
      accent: "#202223",
      alignment: "left",
    },
    {
      id: "packing-branded",
      name: "Branded",
      description: "Highlights your brand and delivery details.",
      accent: "#7c3aed",
      alignment: "left",
    },
    {
      id: "packing-compact",
      name: "Compact",
      description: "A space-saving layout for larger orders.",
      accent: "#008060",
      alignment: "center",
    },
    {
      id: "packing-detailed",
      name: "Detailed",
      description: "Extra room for shipment and item details.",
      accent: "#005bd3",
      alignment: "right",
    },
  ],
};

const isDocumentType = (value: string | null): value is DocumentType => {
  return documentTypes.some(({ id }) => id === value);
};

const selectionKey = (documentType: DocumentType) =>
  `invoice-app:selected-template:${documentType}`;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const salesOrderTemplates = templates["sales-order"];
  const invoiceTemplates = templates.invoice;

  const [shopCurrencyCode, selectedTemplates, ...previews] = await Promise.all([
    fetchShopCurrencyCode(admin),
    loadSelectedTemplatesForShop(session.shop),
    ...salesOrderTemplates.map(async (template) => {
      const loaded = await loadSalesOrderTemplateSettings(
        session.shop,
        template.id,
        admin,
      );
      return [
        template.id,
        {
          settings: loaded.settings,
          storeDetails: loaded.storeDetails,
        } satisfies SalesOrderPreviewBundle,
      ] as const;
    }),
    ...invoiceTemplates.map(async (template) => {
      const loaded = await loadDocumentTemplateSettings(
        session.shop,
        "invoice",
        template.id,
        admin,
      );
      return [
        template.id,
        {
          settings: loaded.settings,
          storeDetails: loaded.storeDetails,
        } satisfies SalesOrderPreviewBundle,
      ] as const;
    }),
  ]);

  return {
    shopCurrencyCode,
    selectedTemplates,
    salesOrderPreviews: Object.fromEntries(previews) as Record<
      string,
      SalesOrderPreviewBundle
    >,
  };
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
        <div className="template-preview__sheet">
          <div
            className="template-preview__accent"
            style={{
              background: template.accent,
            }}
          />
          <div
            className="template-preview__title"
            style={{
              color: template.accent,
              textAlign: template.alignment,
            }}
          >
            {template.name.toUpperCase()}
          </div>
          {[68, 90, 76].map((width) => (
            <div
              key={width}
              className="template-preview__line"
              style={{
                width: `${width}%`,
              }}
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
        </div>
      </div>
    </div>
  );
}

function buildPreviewSettings(
  settings: TemplateEditorSettings,
  templateId: string,
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

  // Template gallery: always show Logo.svg tinted to each preset accent.
  previewSettings.logoDataUrl = templatePreviewLogoDataUrl(preset.accent);
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
  const previewSettings = buildPreviewSettings(preview.settings, templateId);
  const documentNumber = `${previewSettings.numbering.prefix}${previewSettings.numbering.startingNumber}${previewSettings.numbering.suffix ?? ""}`;
  const previewOrder = {
    ...sampleSalesOrderForShop(shopCurrencyCode),
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
          <SalesOrderLiveDocument
            settings={previewSettings}
            templateId={templateId}
            storeDetails={preview.storeDetails}
            showLogoPlaceholder={false}
            order={previewOrder}
          />
        </div>
      </PaperScaleFrame>
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
  const previewSettings = buildPreviewSettings(preview.settings, templateId);
  const documentNumber = `${previewSettings.numbering.prefix}${previewSettings.numbering.startingNumber}${previewSettings.numbering.suffix ?? ""}`;
  const previewOrder = {
    ...sampleSalesOrderForShop(shopCurrencyCode),
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
        <SalesOrderLiveDocument
          settings={previewSettings}
          templateId={templateId}
          storeDetails={preview.storeDetails}
          showLogoPlaceholder={false}
          order={previewOrder}
        />
      </div>
      </PaperScaleFrame>
    </div>
  );
}

export default function TemplatesPage() {
  const {
    salesOrderPreviews,
    shopCurrencyCode,
    selectedTemplates: serverSelectedTemplates,
  } = useLoaderData<typeof loader>();
  const selectFetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
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

  if (location.pathname.startsWith("/app/templates/edit/")) {
    return <Outlet />;
  }

  const salesOrderPreview =
    previewTemplate &&
    (activeType === "sales-order" || activeType === "invoice")
      ? salesOrderPreviews[previewTemplate.id] ||
        (activeType === "sales-order"
          ? salesOrderPreviews[DEFAULT_SALES_ORDER_TEMPLATE_ID]
          : salesOrderPreviews[INVOICE_TEMPLATE_PRESETS[0]!.id])
      : null;

  return (
    <AppProvider i18n={enTranslations}>
    <div className="templates-polaris-shell">
    <s-page heading="Templates" inlineSize="large">
      <div className="templates-page">
        <s-stack direction="block" gap="base">
          <div className="templates-content__header">
            <s-stack direction="block" gap="small">
              <s-heading>{activeDocument.label} templates</s-heading>
              <s-paragraph color="subdued">
                {activeDocument.description}
              </s-paragraph>
            </s-stack>
            <s-badge tone="info">
              {templates[activeType].length} available
            </s-badge>
          </div>

          <div className="templates-layout">
            <div className="templates-sidebar">
              <s-box
                background="base"
                border="base"
                borderRadius="large"
                padding="small"
              >
                <s-box padding="small">
                  <s-heading>Document type</s-heading>
                </s-box>
                <div className="templates-sidebar__items">
                  {documentTypes.map((documentType) => {
                    const isActive = documentType.id === activeType;

                    return (
                      <s-clickable
                        key={documentType.id}
                        accessibilityLabel={`View ${documentType.label} templates`}
                        background={isActive ? "subdued" : "transparent"}
                        borderRadius="base"
                        onClick={() => changeDocumentType(documentType.id)}
                        padding="small"
                      >
                        <s-grid
                          gridTemplateColumns="1fr auto"
                          gap="small"
                          alignItems="center"
                        >
                          <s-text type={isActive ? "strong" : undefined}>
                            {documentType.label}
                          </s-text>
                          {selectedTemplates[documentType.id] ? (
                            <s-icon type="check-circle" tone="success" />
                          ) : null}
                        </s-grid>
                      </s-clickable>
                    );
                  })}
                </div>
              </s-box>
            </div>

            <div className="templates-content">
              <s-stack direction="block" gap="base">
                <div className="templates-grid">
                  {templates[activeType].map((template) => {
                    const isSelected =
                      selectedTemplates[activeType] === template.id;

                    return (
                      <div className="template-card" key={template.id}>
                        <Card padding="0" background="bg-surface">
                          <div className="template-card__inner">
                            {(activeType === "sales-order" ||
                              activeType === "invoice") &&
                            salesOrderPreviews[template.id] ? (
                              <SalesOrderCardThumbnail
                                templateId={template.id}
                                preview={salesOrderPreviews[template.id]}
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
                                  <Button
                                    variant={isSelected ? "secondary" : "primary"}
                                    onClick={
                                      isSelected
                                        ? () =>
                                            navigate(
                                              `/app/templates/edit/${activeType}/${template.id}`,
                                            )
                                        : () => setConfirmTemplate(template)
                                    }
                                  >
                                    {isSelected
                                      ? "Edit template"
                                      : "Use template"}
                                  </Button>
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
