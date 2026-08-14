import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import {
  Outlet,
  PrefetchPageLinks,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigate,
  useRouteError,
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
  Tooltip,
} from "@shopify/polaris";
import { ImportIcon } from "@shopify/polaris-icons";
import enTranslations from "@shopify/polaris/locales/en.json";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import { useAdminI18n } from "../admin-i18n-context";
import {
  templatesDocTypeDesc,
  templatesDocTypeLabel,
  templatesHeading,
  templatesPresetDescription,
  templatesPresetName,
  templatesT,
  templatesTf,
} from "../admin-templates-i18n";
import {
  defaultTemplateSettings,
  getSalesOrderTemplatePreset,
  mergeTemplateSettings,
  paperPaddingCss,
  SALES_ORDER_TEMPLATE_PRESETS,
  INVOICE_TEMPLATE_PRESETS,
  DRAFT_TEMPLATE_PRESETS,
  CREDIT_NOTE_TEMPLATE_PRESETS,
  PACKING_SLIP_TEMPLATE_PRESETS,
  RETURN_TEMPLATE_PRESETS,
  salesOrderTemplateName,
  type TemplateEditorSettings,
} from "../sales-order-document";
import { sampleSalesOrderForShop, sampleCreditNoteForShop } from "../sales-order-sample";
import { requireAdminAuth } from "../shopify-context.server";
import { resetAllTemplatesToCleanDefaults, reupdateAllShopTemplates, reupdateAllShopTemplatesIfNeeded } from "../sales-order-document.server";
import {
  loadNumberSeriesForShop,
  loadSelectedTemplatesForShop,
  loadStoreDetailsForShop,
  saveSelectedTemplateForShop,
} from "../shop-settings.server";
import { markSetupGuideStep } from "../setup-guide.server";
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

const loadSalesOrderLiveDocument = () =>
  import("../components/sales-order-live-document").then((mod) => ({
    default: mod.SalesOrderLiveDocument,
  }));

const SalesOrderLiveDocument = lazy(loadSalesOrderLiveDocument);

/** Cap concurrent live gallery thumbs so many cards don't fight for main thread. */
const GALLERY_THUMB_MAX = 2;
let galleryThumbActive = 0;
const galleryThumbWaiters: Array<() => void> = [];

function acquireGalleryThumbSlot(): Promise<void> {
  if (galleryThumbActive < GALLERY_THUMB_MAX) {
    galleryThumbActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    galleryThumbWaiters.push(() => {
      galleryThumbActive += 1;
      resolve();
    });
  });
}

function releaseGalleryThumbSlot() {
  galleryThumbActive = Math.max(0, galleryThumbActive - 1);
  const next = galleryThumbWaiters.shift();
  if (next) next();
}

/** Gallery cards: no CDN product images (biggest thumb latency). */
function galleryPreviewOrder(
  templateId: string,
  shopCurrencyCode: string,
  documentNumber: string,
) {
  const base = templateId.startsWith("credit-")
    ? sampleCreditNoteForShop(shopCurrencyCode)
    : sampleSalesOrderForShop(shopCurrencyCode);
  return {
    ...base,
    name: "#1008",
    documentNumber,
    referenceNumber: base.referenceNumber || "SO-0001",
    lineItems: base.lineItems.map((item) => ({ ...item, imageUrl: "" })),
  };
}

type DocumentType =
  | "sales-order"
  | "invoice"
  | "draft"
  | "credit-note"
  | "packing-slip"
  | "return";

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

const documentTypeIds: DocumentType[] = [
  "sales-order",
  "invoice",
  "draft",
  "credit-note",
  "packing-slip",
  "return",
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
  draft: DRAFT_TEMPLATE_PRESETS.map((preset) => ({
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
  return: RETURN_TEMPLATE_PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    accent: preset.accent,
    alignment: preset.alignment,
  })),
};

const isDocumentType = (value: string | null): value is DocumentType => {
  return documentTypeIds.some((id) => id === value);
};

const selectionKey = (documentType: DocumentType) =>
  `invoice-app:selected-template:${documentType}`;

function buildPreviewBundle(args: {
  documentType:
    | "sales-order"
    | "invoice"
    | "draft"
    | "credit-note"
    | "packing-slip"
    | "return";
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
  // Pin document-type header defaults, then keep merchant toggles on top.
  settings.header = { ...defaults.header, ...settings.header };
  const title = settings.transactionLabels.documentTitle?.trim() ?? "";
  const knownTitles = new Set([
    "SALES ORDER",
    "INVOICE",
    "DRAFT",
    "CREDIT NOTE",
    "PACKING SLIP",
    "RETURN",
  ]);
  const expected =
    args.documentType === "draft"
      ? "DRAFT"
      : args.documentType === "invoice"
        ? "INVOICE"
        : args.documentType === "credit-note"
          ? "CREDIT NOTE"
          : args.documentType === "packing-slip"
            ? "PACKING SLIP"
            : args.documentType === "return"
              ? "RETURN"
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
    // Gallery paint must not wait on schema reupdate (N row updates + pool=1
    // timeouts). Migrate in the background after the read path finishes.
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
                  in: [
                    "sales-order",
                    "invoice",
                    "draft",
                    "credit-note",
                    "packing-slip",
                    "return",
                  ],
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

    void reupdateAllShopTemplatesIfNeeded(session.shop).catch((error) => {
      console.error("Background template reupdate failed:", error);
    });

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

const TEMPLATES_CLIENT_TTL_MS = 120_000;
const templatesClientCache = new Map<string, { expires: number; data: unknown }>();

function bustTemplatesClientCache() {
  templatesClientCache.clear();
}

export function shouldRevalidate({
  formMethod,
}: {
  formMethod?: string | null;
}) {
  // Gallery only needs to refetch after select-template / reset-all actions.
  if (formMethod && formMethod.toUpperCase() !== "GET") {
    bustTemplatesClientCache();
    return true;
  }
  return false;
}

export async function clientLoader({
  request,
  serverLoader,
}: ClientLoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.pathname.includes("/templates/edit/")) {
    return serverLoader();
  }
  const key = url.pathname;
  const hit = templatesClientCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  const data = await serverLoader();
  templatesClientCache.set(key, {
    expires: Date.now() + TEMPLATES_CLIENT_TTL_MS,
    data,
  });
  return data;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "reset-all-templates") {
    const result = await resetAllTemplatesToCleanDefaults(session.shop);
    return Response.json({ ok: true, ...result });
  }

  if (intent === "reupdate-all-templates") {
    const result = await reupdateAllShopTemplates(session.shop);
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
    await markSetupGuideStep(session.shop, "templates");
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
  opts?: { galleryCard?: boolean },
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
      showPaidAmount:
        templateId.startsWith("draft-") ||
        templateId.startsWith("credit-") ||
        templateId.startsWith("packing-") ||
        templateId.startsWith("return-")
          ? false
          : true,
      showBalanceDue:
        templateId.startsWith("draft-") ||
        templateId.startsWith("credit-") ||
        templateId.startsWith("packing-") ||
        templateId.startsWith("return-")
          ? false
          : true,
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

  // Gallery thumbs: hide product images (CDN was stalling Modern cards).
  if (opts?.galleryCard) {
    previewSettings.columns = previewSettings.columns.map((col) =>
      col.showImage ? { ...col, showImage: false } : col,
    );
  }

  return previewSettings;
}

function SalesOrderCardThumbnail({
  templateId,
  preview,
  shopCurrencyCode,
  onReady,
}: {
  templateId: string;
  preview: SalesOrderPreviewBundle;
  shopCurrencyCode: string;
  onReady?: () => void;
}) {
  const previewSettings = buildPreviewSettings(
    preview.settings,
    templateId,
    preview.storeDetails.logoDataUrl,
    { galleryCard: true },
  );
  const documentNumber = `${previewSettings.numbering.prefix}${previewSettings.numbering.startingNumber}${previewSettings.numbering.suffix ?? ""}`;
  const previewOrder = galleryPreviewOrder(
    templateId,
    shopCurrencyCode,
    documentNumber,
  );

  return (
    <div aria-hidden="true" className="template-card-thumb">
      <PaperScaleFrame
        className="template-card-thumb__scale"
        fit="contain"
        optimistic
      >
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
            <GalleryThumbReadyBeacon onReady={onReady} />
          </Suspense>
        </div>
      </PaperScaleFrame>
    </div>
  );
}

/** Fires after the lazy live document mounts (not merely after scale). */
function GalleryThumbReadyBeacon({ onReady }: { onReady?: () => void }) {
  useEffect(() => {
    if (!onReady) return;
    const id = requestAnimationFrame(() => onReady());
    return () => cancelAnimationFrame(id);
  }, [onReady]);
  return null;
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
  const [slotGranted, setSlotGranted] = useState(false);
  const [liveReady, setLiveReady] = useState(false);
  const slotHeldRef = useRef(false);

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
      // Smaller margin = fewer cards race to mount at once.
      { rootMargin: "40px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !visible) return;
    let cancelled = false;
    void acquireGalleryThumbSlot().then(() => {
      if (cancelled) {
        releaseGalleryThumbSlot();
        return;
      }
      slotHeldRef.current = true;
      setSlotGranted(true);
    });
    return () => {
      cancelled = true;
      if (slotHeldRef.current) {
        slotHeldRef.current = false;
        releaseGalleryThumbSlot();
      }
    };
  }, [mounted, visible]);

  const handleLiveReady = useCallback(() => {
    setLiveReady(true);
    if (slotHeldRef.current) {
      slotHeldRef.current = false;
      releaseGalleryThumbSlot();
    }
  }, []);

  return (
    <div ref={hostRef} style={{ position: "relative" }}>
      {/* CSS sketch stays until live thumb paints — no blank spinner gap. */}
      {!liveReady ? <TemplateThumbnail template={template} /> : null}
      {mounted && visible && slotGranted ? (
        <div
          style={
            liveReady
              ? undefined
              : {
                  position: "absolute",
                  inset: 0,
                  opacity: 0,
                  pointerEvents: "none",
                }
          }
        >
          <SalesOrderCardThumbnail
            templateId={template.id}
            preview={preview}
            shopCurrencyCode={shopCurrencyCode}
            onReady={handleLiveReady}
          />
        </div>
      ) : null}
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
  const { t, language } = useAdminI18n();
  const selectFetcher = useFetcher<typeof action>();
  const storeBrandWarmFetcher = useFetcher();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isEditRoute = location.pathname.includes("/templates/edit/");
  const requestedType = searchParams.get("type");
  const [activeType, setActiveType] = useState<DocumentType>(
    isDocumentType(requestedType) ? requestedType : "sales-order",
  );
  const activeTypeLabel = templatesDocTypeLabel(language, activeType);
  const activeTypeDesc = templatesDocTypeDesc(language, activeType);
  const [selectedTemplates, setSelectedTemplates] = useState<
    Partial<Record<DocumentType, string>>
  >({});
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState<Template | null>(null);
  const [downloadingTemplateId, setDownloadingTemplateId] = useState<
    string | null
  >(null);

  // Live card thumbs for the visible document type only (~15, not all 60).
  // Cards mount via IntersectionObserver so first paint stays light.
  useEffect(() => {
    if (isEditRoute) return;
    let cancelled = false;
    const preload = () => {
      if (!cancelled) void loadSalesOrderLiveDocument();
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(preload);
    } else {
      timeoutId = setTimeout(preload, 100);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [isEditRoute]);

  // Warm store logo cache so Edit opens with brand ready (logo is deferred from edit loader).
  useEffect(() => {
    if (isEditRoute) return;
    if (!selectedTemplates[activeType]) return;
    if (storeBrandWarmFetcher.data || storeBrandWarmFetcher.state !== "idle") {
      return;
    }
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const warm = () => storeBrandWarmFetcher.load("/app/templates/store-brand");
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(warm, { timeout: 2500 });
    } else {
      timeoutId = setTimeout(warm, 500);
    }
    return () => {
      if (idleId !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warm once per selection
  }, [isEditRoute, activeType, selectedTemplates]);

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

    documentTypeIds.forEach((id) => {
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

  const downloadTemplatePreview = useCallback(
    async (template: Template) => {
      if (downloadingTemplateId) return;
      const preview = salesOrderPreviews[template.id];
      if (!preview) {
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(templatesT(language, "tpl.pdfFailed"), {
            isError: true,
          });
        }
        return;
      }

      setDownloadingTemplateId(template.id);
      try {
        const previewSettings = buildPreviewSettings(
          preview.settings,
          template.id,
          preview.storeDetails.logoDataUrl,
        );
        const documentNumber = `${previewSettings.numbering.prefix}${previewSettings.numbering.startingNumber}${previewSettings.numbering.suffix ?? ""}`;
        const previewOrder = {
          ...(template.id.startsWith("credit-")
            ? sampleCreditNoteForShop(shopCurrencyCode)
            : sampleSalesOrderForShop(shopCurrencyCode)),
          name: "#1008",
          documentNumber,
        };
        const { downloadTemplatePreviewPdf } = await import(
          "../sales-order-dom-export.client"
        );
        await downloadTemplatePreviewPdf({
          templateId: template.id,
          settings: previewSettings,
          storeDetails: preview.storeDetails,
          order: previewOrder,
          documentKind: activeType,
        });
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(templatesT(language, "tpl.pdfDownloaded"));
        }
      } catch (error) {
        console.error("Template preview PDF download failed:", error);
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(templatesT(language, "tpl.pdfFailed"), {
            isError: true,
          });
        }
      } finally {
        setDownloadingTemplateId(null);
      }
    },
    [
      activeType,
      downloadingTemplateId,
      language,
      salesOrderPreviews,
      shopCurrencyCode,
    ],
  );

  if (isEditRoute) {
    return <Outlet />;
  }

  const salesOrderPreview = salesOrderPreviewBundle;
  const selectedEditPath = selectedTemplates[activeType]
    ? `/app/templates/edit/${activeType}/${selectedTemplates[activeType]}`
    : null;

  return (
    <AppProvider i18n={enTranslations}>
    <div className="templates-polaris-shell">
    {selectedEditPath ? <PrefetchPageLinks page={selectedEditPath} /> : null}
    <s-page heading={t("pages.templates")} inlineSize="large">
      <div className="templates-page">
        <s-stack direction="block" gap="base">
          <div className="templates-content__header">
            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">
                {templatesHeading(language, activeType)}
              </Text>
              <Text as="p" tone="subdued">
                {activeTypeDesc}
              </Text>
            </BlockStack>
            <Badge tone="info">
              {templatesTf(language, "tpl.available", {
                count: String(templates[activeType].length),
              })}
            </Badge>
          </div>

          <div className="templates-layout">
            <div className="templates-sidebar">
              <Card padding="0">
                <Box paddingBlockStart="300" paddingInline="300" paddingBlockEnd="100">
                  <Text as="h3" variant="headingSm">
                    {templatesT(language, "tpl.documentType")}
                  </Text>
                </Box>
                <ActionList
                  actionRole="menuitem"
                  items={documentTypeIds.map((documentType) => ({
                    content: templatesDocTypeLabel(language, documentType),
                    active: documentType === activeType,
                    onAction: () => changeDocumentType(documentType),
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
                    const displayName = templatesPresetName(
                      language,
                      template.name,
                    );
                    const displayDescription = templatesPresetDescription(
                      language,
                      template.description,
                    );

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
                                    {displayName}
                                  </Text>
                                  {isSelected ? (
                                    <Badge tone="success">
                                      {templatesT(language, "tpl.active")}
                                    </Badge>
                                  ) : null}
                                </InlineStack>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  <span className="template-card__description">
                                    {displayDescription}
                                  </span>
                                </Text>
                                <div className="template-card__actions">
                                  <div className="template-card__actions-download">
                                    <Tooltip
                                      content={templatesT(
                                        language,
                                        "tpl.downloadPdf",
                                      )}
                                    >
                                      <Button
                                        icon={ImportIcon}
                                        variant="secondary"
                                        accessibilityLabel={templatesT(
                                          language,
                                          "tpl.downloadPdf",
                                        )}
                                        loading={
                                          downloadingTemplateId === template.id
                                        }
                                        disabled={
                                          downloadingTemplateId !== null &&
                                          downloadingTemplateId !== template.id
                                        }
                                        onClick={() => {
                                          void downloadTemplatePreview(template);
                                        }}
                                      />
                                    </Tooltip>
                                  </div>
                                  <Button
                                    onClick={() => setPreviewTemplate(template)}
                                  >
                                    {templatesT(language, "tpl.preview")}
                                  </Button>
                                  {isSelected ? (
                                    <Button
                                      variant="secondary"
                                      onClick={() =>
                                        navigate(
                                          `/app/templates/edit/${activeType}/${template.id}`,
                                        )
                                      }
                                    >
                                      {templatesT(language, "tpl.edit")}
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="primary"
                                      onClick={() => setConfirmTemplate(template)}
                                    >
                                      {templatesT(language, "tpl.use")}
                                    </Button>
                                  )}
                                </div>
                                {isSelected ? (
                                  <PrefetchPageLinks
                                    page={`/app/templates/edit/${activeType}/${template.id}`}
                                  />
                                ) : null}
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
        title={templatesT(language, "tpl.useConfirmTitle")}
        primaryAction={{
          content: templatesT(language, "tpl.useConfirmYes"),
          onAction: confirmUseTemplate,
        }}
        secondaryActions={[
          {
            content: templatesT(language, "tpl.useConfirmCancel"),
            onAction: () => setConfirmTemplate(null),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            {confirmTemplate
              ? templatesTf(language, "tpl.useConfirmBody", {
                  name: templatesPresetName(language, confirmTemplate.name),
                  type: activeTypeLabel,
                })
              : templatesT(language, "tpl.useConfirmTitle")}
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
                  {templatesPresetName(language, previewTemplate.name)}
                </s-heading>
                <s-paragraph color="subdued">
                  {templatesTf(language, "tpl.previewSubtitle", {
                    type: activeTypeLabel,
                  })}
                </s-paragraph>
              </div>
              <div className="template-preview-modal__header-actions">
                <Tooltip
                  content={templatesT(language, "tpl.downloadPdf")}
                >
                  <Button
                    icon={ImportIcon}
                    variant="secondary"
                    accessibilityLabel={templatesT(
                      language,
                      "tpl.downloadPdf",
                    )}
                    loading={downloadingTemplateId === previewTemplate.id}
                    disabled={
                      downloadingTemplateId !== null &&
                      downloadingTemplateId !== previewTemplate.id
                    }
                    onClick={() => {
                      void downloadTemplatePreview(previewTemplate);
                    }}
                  />
                </Tooltip>
                <button
                  aria-label={templatesT(language, "tpl.close")}
                  className="template-preview-modal__close"
                  onClick={() => setPreviewTemplate(null)}
                  type="button"
                >
                  ×
                </button>
              </div>
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

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:templates-reload");
}
