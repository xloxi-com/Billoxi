import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { renderEmbeddedRouteError } from "../embedded-route-error";
import {
  AppProvider,
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Banner,
  Badge,
  Divider,
  Box,
  Collapsible,
  DataTable,
  DropZone,
  Icon,
  Link,
  RadioButton,
  Tabs,
  Thumbnail,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardIcon,
  CurrencyConvertIcon,
  DragHandleIcon,
  EditIcon,
  EmailIcon,
  NoteIcon,
  OrderIcon,
  ReceiptIcon,
  StoreIcon,
} from "@shopify/polaris-icons";

import type { EmailBodyEditorHandle } from "../components/email-body-editor";
import { AppearanceColorField } from "../components/appearance-color-field";

const EmailBodyEditor = lazy(() =>
  import("../components/email-body-editor").then((mod) => ({
    default: mod.EmailBodyEditor,
  })),
);
import { requireAdminAuth } from "../shopify-context.server";
import {
  formatNumberSeriesNextPreview,
  formatNumberSeriesValue,
  normalizeNumberSeries,
  NUMBER_SERIES_MODULES,
  numberingFromSeries,
  parseNumberSeriesDigits,
  widenStartingNumberPad,
  type NumberSeriesEntry,
  type NumberSeriesMap,
  type NumberSeriesModuleId,
} from "../number-series";
import {
  getInvoiceNumberDigitWidth,
  getLastInvoiceAllocatedSequence,
} from "../order-invoice-status.server";
import { getLastDraftAllocatedSequence } from "../order-invoice-draft-status.server";
import { getLastReturnAllocatedSequence } from "../order-return-status.server";
import {
  GMAIL_SMTP_PRESET,
  WEBMAIL_SMTP_PRESET,
  isSmtpReadyForSend,
  normalizeSmtpSettings,
  type SmtpSettings,
} from "../smtp-settings";
import {
  EMAIL_TEMPLATE_PLACEHOLDERS,
  EMAIL_TEMPLATES_READY_SET_VERSION,
  applyEmailTemplateVars,
  bodyContentToHtml,
  documentKindLabel,
  getDefaultEmailTemplate,
  getReadyEmailTemplates,
  normalizeEmailTemplatesSettings,
  type EmailDocumentKind,
  type EmailTemplatesSettings,
} from "../email-templates";
import {
  createStoreCustomField,
  normalizeStoreDetails,
  normalizeStoreLogoDataUrl,
  type StoreCustomField,
  type StoreDetails,
} from "../store-details";
import {
  loadEmailTemplatesForShop,
  loadCreditNoteSettingsForShop,
  loadInvoiceSettingsForShop,
  loadMultiCurrencySettingsForShop,
  loadNumberSeriesForShop,
  loadSelectedTemplateForShop,
  loadSmtpSettingsForShop,
  loadStoreDetailsForShop,
  resetStoreDetailsFromShopify,
  saveEmailTemplatesForShop,
  saveCreditNoteSettingsForShop,
  saveInvoiceSettingsForShop,
  saveMultiCurrencySettingsForShop,
  saveNumberSeriesForShop,
  saveSmtpSettingsForShop,
  saveStoreDetailsForShop,
} from "../shop-settings.server";
import { markSetupGuideStep } from "../setup-guide.server";
import {
  normalizeCreditNoteSettings,
  type CreditNoteSettings,
} from "../credit-note-settings";
import {
  normalizeInvoiceSettings,
  type InvoiceSettings,
} from "../invoice-settings";
import {
  normalizeMultiCurrencySettings,
  type MultiCurrencySettings,
} from "../multi-currency-settings";
import {
  getLastAllocatedSequence,
  syncNumberCounter,
  validateStartingNumber,
} from "../sales-order-number.server";
import { resolveSalesOrderTemplateId } from "../sales-order-ids";
import { backfillAutoCreditNotesForShop } from "../auto-credit-note.server";
import {
  CUSTOMER_DOWNLOAD_DOCUMENT_TYPES,
  type CustomerDownloadDocumentType,
} from "../customer-download-links";
import { customerDownloadSnippetsForShop } from "../customer-download-links.server";
import "../settings.css";
import { RecommendedAppsSidebar } from "../components/recommended-apps";

function getNumberSeriesAlreadyUsedError(
  current: NumberSeriesMap,
  saved: NumberSeriesMap,
  lastByModule: Record<NumberSeriesModuleId, number | null>,
): string | null {
  const modules: NumberSeriesModuleId[] = [
    "sales-order",
    "invoice",
    "draft",
    "return",
  ];
  for (const moduleId of modules) {
    const entry = current[moduleId];
    const last = lastByModule[moduleId];
    if (last == null) continue;

    const startAt = Number.parseInt(entry.startingNumber, 10);
    const prevStart = Number.parseInt(saved[moduleId].startingNumber, 10);
    const start =
      Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
    const previousStart =
      Number.isFinite(prevStart) && prevStart >= 0 ? prevStart : null;

    if (
      (previousStart == null || previousStart !== start) &&
      start <= last
    ) {
      const used = formatNumberSeriesValue(entry, start);
      const min = formatNumberSeriesValue(entry, last + 1);
      return `${used} is already used. Enter ${min} or higher.`;
    }

    if (
      typeof entry.nextSequence === "number" &&
      Number.isFinite(entry.nextSequence) &&
      entry.nextSequence <= last
    ) {
      const used = formatNumberSeriesValue(
        entry,
        Math.floor(entry.nextSequence),
      );
      const min = formatNumberSeriesValue(entry, last + 1);
      return `${used} is already used. Enter ${min} or higher.`;
    }
  }
  return null;
}

type SettingsSection =
  | "store-details"
  | "number-series"
  | "credit-notes"
  | "multi-currency"
  | "download-links"
  | "smtp"
  | "email-sales-order"
  | "email-invoice"
  | "email-draft"
  | "email-credit-note"
  | "email-packing-slip"
  | "email-return";

type SettingsMenuItem = {
  id: SettingsSection;
  label: string;
  description: string;
  icon: "store" | "order" | "email" | "note" | "receipt" | "currency" | "clipboard";
};

type SettingsMenuGroup = {
  id: "email-templates";
  label: string;
  icon: "note";
  children: Array<{
    id: SettingsSection;
    label: string;
    description: string;
    kind: EmailDocumentKind;
  }>;
};

const EMAIL_TEMPLATE_SECTIONS: SettingsMenuGroup["children"] = [
  {
    id: "email-sales-order",
    label: "Sales Orders",
    kind: "sales-order",
    description: "Subject, body, and PDF for Sales order emails.",
  },
  {
    id: "email-invoice",
    label: "Invoice",
    kind: "invoice",
    description: "Subject, body, and PDF for Invoice emails.",
  },
  {
    id: "email-draft",
    label: "Draft",
    kind: "draft",
    description: "Subject, body, and PDF for Draft emails.",
  },
  {
    id: "email-credit-note",
    label: "Credit Note",
    kind: "credit-note",
    description: "Subject, body, and PDF for Credit note emails.",
  },
  {
    id: "email-packing-slip",
    label: "Packing Slip",
    kind: "packing-slip",
    description: "Subject, body, and PDF for Packing slip emails.",
  },
  {
    id: "email-return",
    label: "Return",
    kind: "return",
    description: "Subject, body, and PDF for Return emails.",
  },
];

const settingsMenu: Array<SettingsMenuItem | SettingsMenuGroup> = [
  {
    id: "store-details",
    label: "Store details",
    description: "Info shown on document headers.",
    icon: "store",
  },
  {
    id: "number-series",
    label: "Transaction numbers",
    description: "Prefix and starting numbers per module.",
    icon: "order",
  },
  {
    id: "credit-notes",
    label: "Advanced",
    description: "Auto-create on cancel and refund.",
    icon: "receipt",
  },
  {
    id: "multi-currency",
    label: "Multi Currency",
    description:
      "Show documents in the customer checkout currency or shop currency.",
    icon: "currency",
  },
  {
    id: "download-links",
    label: "Download links",
    description: "PDF links for Shopify notification emails.",
    icon: "clipboard",
  },
  {
    id: "smtp",
    label: "SMTP",
    description: "Email server for sending documents.",
    icon: "email",
  },
  {
    id: "email-templates",
    label: "Email templates",
    icon: "note",
    children: EMAIL_TEMPLATE_SECTIONS,
  },
];

const SETTINGS_MENU_ICONS: Record<SettingsMenuItem["icon"], typeof StoreIcon> = {
  store: StoreIcon,
  order: OrderIcon,
  email: EmailIcon,
  note: NoteIcon,
  receipt: ReceiptIcon,
  currency: CurrencyConvertIcon,
  clipboard: ClipboardIcon,
};

function isEmailTemplatesSection(section: SettingsSection): boolean {
  return (
    section === "email-sales-order" ||
    section === "email-invoice" ||
    section === "email-draft" ||
    section === "email-credit-note" ||
    section === "email-packing-slip" ||
    section === "email-return"
  );
}

function parseSettingsSection(value: string | null): SettingsSection {
  if (
    value === "number-series" ||
    value === "transaction-numbers" ||
    value === "credit-notes" ||
    value === "multi-currency" ||
    value === "download-links" ||
    value === "smtp" ||
    value === "store-details" ||
    value === "email-sales-order" ||
    value === "email-invoice" ||
    value === "email-draft" ||
    value === "email-credit-note" ||
    value === "email-packing-slip" ||
    value === "email-return"
  ) {
    return value === "transaction-numbers" ? "number-series" : value;
  }
  // Legacy ?section=email-templates
  if (value === "email-templates") return "email-invoice";
  return "store-details";
}

function emailKindFromSection(section: SettingsSection): EmailDocumentKind {
  const match = EMAIL_TEMPLATE_SECTIONS.find((item) => item.id === section);
  return match?.kind ?? "invoice";
}

function redactSmtpPassword(settings: SmtpSettings): SmtpSettings {
  return { ...settings, password: "" };
}

/** Keep Space inside inputs from being stolen by parent/admin shortcuts. */
function stopInputShortcutPropagation(
  event: ReactKeyboardEvent<HTMLElement>,
) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const tag = target.tagName;
  if (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  ) {
    event.stopPropagation();
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const [
    selectedSalesOrderTemplateIdRaw,
    storeDetails,
    smtpSettings,
    emailTemplates,
    numberSeries,
    creditNoteSettings,
    invoiceSettings,
    multiCurrencySettings,
  ] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadStoreDetailsForShop(session.shop, admin),
    loadSmtpSettingsForShop(session.shop),
    loadEmailTemplatesForShop(session.shop),
    loadNumberSeriesForShop(session.shop),
    loadCreditNoteSettingsForShop(session.shop),
    loadInvoiceSettingsForShop(session.shop),
    loadMultiCurrencySettingsForShop(session.shop),
  ]);
  const selectedSalesOrderTemplateId = resolveSalesOrderTemplateId(
    selectedSalesOrderTemplateIdRaw,
  );
  const [
    lastAllocatedSequence,
    lastInvoiceSequence,
    lastDraftSequence,
    lastReturnSequence,
    invoiceDigitWidth,
  ] = await Promise.all([
    getLastAllocatedSequence(session.shop),
    getLastInvoiceAllocatedSequence(session.shop),
    getLastDraftAllocatedSequence(session.shop),
    getLastReturnAllocatedSequence(session.shop),
    getInvoiceNumberDigitWidth(session.shop),
  ]);
  const lastAllocatedByModule: Record<NumberSeriesModuleId, number | null> = {
    "sales-order": lastAllocatedSequence,
    invoice: lastInvoiceSequence,
    draft: lastDraftSequence,
    return: lastReturnSequence,
    "credit-note": null,
    "packing-slip": null,
  };
  return {
    storeDetails,
    smtpSettings: redactSmtpPassword(smtpSettings),
    emailTemplates,
    numberSeries,
    lastAllocatedSequence,
    lastAllocatedByModule,
    invoiceDigitWidth,
    hasSmtpPassword: Boolean(smtpSettings.password),
    creditNoteSettings,
    invoiceSettings,
    multiCurrencySettings,
    shopDomain: session.shop,
    downloadLinkSnippets: customerDownloadSnippetsForShop(session.shop, request),
  };
}

export function shouldRevalidate({
  formMethod,
}: {
  formMethod?: string | null;
}) {
  if (formMethod && formMethod.toUpperCase() !== "GET") return true;
  return false;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reset") {
    const storeDetails = await resetStoreDetailsFromShopify(
      session.shop,
      admin,
    );
    await markSetupGuideStep(session.shop, "store-details");
    return { saved: true, section: "store-details" as const, storeDetails };
  }

  if (intent === "save-credit-notes") {
    const raw = formData.get("creditNoteSettings");
    const rawInvoice = formData.get("invoiceSettings");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "Credit note settings are required." },
        { status: 400 },
      );
    }
    if (typeof rawInvoice !== "string") {
      return Response.json(
        { saved: false, error: "Invoice settings are required." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    let parsedInvoice: unknown;
    try {
      parsed = JSON.parse(raw);
      parsedInvoice = JSON.parse(rawInvoice);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid advanced settings." },
        { status: 400 },
      );
    }

    const creditNoteSettings = normalizeCreditNoteSettings(parsed);
    const invoiceSettings = normalizeInvoiceSettings(parsedInvoice);
    const [saved, savedInvoice] = await Promise.all([
      saveCreditNoteSettingsForShop(session.shop, creditNoteSettings),
      saveInvoiceSettingsForShop(session.shop, invoiceSettings),
    ]);

    let backfilled = 0;
    try {
      const result = await backfillAutoCreditNotesForShop(
        session.shop,
        admin,
      );
      backfilled = result.created;
    } catch (error) {
      console.error("credit-note settings backfill failed", error);
    }

    return {
      saved: true,
      section: "credit-notes" as const,
      creditNoteSettings: saved,
      invoiceSettings: savedInvoice,
      backfilledCreditNotes: backfilled,
    };
  }

  if (intent === "save-multi-currency") {
    const raw = formData.get("multiCurrencySettings");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "Multi currency settings are required." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid multi currency settings." },
        { status: 400 },
      );
    }

    const saved = await saveMultiCurrencySettingsForShop(
      session.shop,
      normalizeMultiCurrencySettings(parsed),
    );

    return {
      saved: true,
      section: "multi-currency" as const,
      multiCurrencySettings: saved,
    };
  }

  if (intent === "save-smtp") {
    const raw = formData.get("smtpSettings");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "SMTP settings are required." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid SMTP settings." },
        { status: 400 },
      );
    }

    const smtpSettings = normalizeSmtpSettings(parsed);
    if (smtpSettings.host && !smtpSettings.fromEmail) {
      return Response.json(
        { saved: false, error: "From email is required when SMTP host is set." },
        { status: 400 },
      );
    }

    const saved = await saveSmtpSettingsForShop(session.shop, smtpSettings);
    if (isSmtpReadyForSend(saved)) {
      await markSetupGuideStep(session.shop, "smtp");
    }
    return {
      saved: true,
      section: "smtp" as const,
      smtpSettings: redactSmtpPassword(saved),
      hasSmtpPassword: Boolean(saved.password),
    };
  }

  if (intent === "save-email-templates") {
    const raw = formData.get("emailTemplates");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "Missing email templates." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid email templates." },
        { status: 400 },
      );
    }

    const emailTemplates = normalizeEmailTemplatesSettings(parsed);
    const saved = await saveEmailTemplatesForShop(session.shop, emailTemplates);
    return {
      saved: true,
      section: "email-templates" as const,
      emailTemplates: saved,
    };
  }

  if (intent === "save-number-series") {
    const raw = formData.get("numberSeries");
    if (typeof raw !== "string") {
      return Response.json(
        { saved: false, error: "Number series settings are required." },
        { status: 400 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { saved: false, error: "Invalid number series settings." },
        { status: 400 },
      );
    }

    const numberSeries = normalizeNumberSeries(parsed);
    const previous = await loadNumberSeriesForShop(session.shop);
    const selectedTemplateId = resolveSalesOrderTemplateId(
      await loadSelectedTemplateForShop(session.shop, "sales-order"),
    );
    const numbering = numberingFromSeries(numberSeries["sales-order"]);
    const previousNumbering = numberingFromSeries(previous["sales-order"]);
    const numberingError = await validateStartingNumber(
      session.shop,
      selectedTemplateId,
      numbering,
      previousNumbering,
      { nextSequence: numberSeries["sales-order"].nextSequence },
    );
    if (numberingError) {
      return Response.json(
        { saved: false, error: numberingError },
        { status: 400 },
      );
    }

    const invoiceLast = await getLastInvoiceAllocatedSequence(session.shop);
    const invoiceEntry = numberSeries.invoice;
    const previousInvoice = previous.invoice;
    const invoiceStart = Number.parseInt(invoiceEntry.startingNumber, 10);
    const previousInvoiceStart = Number.parseInt(
      previousInvoice.startingNumber,
      10,
    );
    const invoiceStartAt =
      Number.isFinite(invoiceStart) && invoiceStart >= 0 ? invoiceStart : 1;
    const previousInvoiceStartAt =
      Number.isFinite(previousInvoiceStart) && previousInvoiceStart >= 0
        ? previousInvoiceStart
        : null;
    if (
      invoiceLast != null &&
      (previousInvoiceStartAt == null ||
        previousInvoiceStartAt !== invoiceStartAt) &&
      invoiceStartAt <= invoiceLast
    ) {
      const used = formatNumberSeriesValue(invoiceEntry, invoiceStartAt);
      const min = formatNumberSeriesValue(invoiceEntry, invoiceLast + 1);
      return Response.json(
        {
          saved: false,
          error: `${used} is already used. Enter ${min} or higher.`,
        },
        { status: 400 },
      );
    }
    const invoiceNext = invoiceEntry.nextSequence;
    if (
      typeof invoiceNext === "number" &&
      Number.isFinite(invoiceNext) &&
      invoiceLast != null &&
      invoiceNext <= invoiceLast
    ) {
      const used = formatNumberSeriesValue(invoiceEntry, Math.floor(invoiceNext));
      const min = formatNumberSeriesValue(invoiceEntry, invoiceLast + 1);
      return Response.json(
        {
          saved: false,
          error: `${used} is already used. Enter ${min} or higher.`,
        },
        { status: 400 },
      );
    }

    const saved = await saveNumberSeriesForShop(session.shop, numberSeries);
    await syncNumberCounter(
      session.shop,
      selectedTemplateId,
      numbering,
      saved["sales-order"].nextSequence,
    );
    const [
      lastAllocatedSequence,
      lastInvoiceSequence,
      lastDraftSequence,
      lastReturnSequence,
      invoiceDigitWidth,
    ] = await Promise.all([
      getLastAllocatedSequence(session.shop),
      getLastInvoiceAllocatedSequence(session.shop),
      getLastDraftAllocatedSequence(session.shop),
      getLastReturnAllocatedSequence(session.shop),
      getInvoiceNumberDigitWidth(session.shop),
    ]);
    return {
      saved: true,
      section: "number-series" as const,
      numberSeries: saved,
      lastAllocatedSequence,
      lastAllocatedByModule: {
        "sales-order": lastAllocatedSequence,
        invoice: lastInvoiceSequence,
        draft: lastDraftSequence,
        return: lastReturnSequence,
        "credit-note": null,
        "packing-slip": null,
      } satisfies Record<NumberSeriesModuleId, number | null>,
      invoiceDigitWidth,
    };
  }

  const raw = formData.get("storeDetails");
  if (typeof raw !== "string") {
    return Response.json(
      { saved: false, error: "Store details are required." },
      { status: 400 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json(
      { saved: false, error: "Invalid store details." },
      { status: 400 },
    );
  }

  const rawLogo =
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "logoDataUrl" in parsed &&
    typeof (parsed as { logoDataUrl?: unknown }).logoDataUrl === "string"
      ? (parsed as { logoDataUrl: string }).logoDataUrl.trim()
      : "";

  const storeDetails = normalizeStoreDetails(parsed);
  if (!storeDetails.name) {
    return Response.json(
      { saved: false, error: "Store name is required." },
      { status: 400 },
    );
  }

  // Client sent a logo but it was stripped — tell the merchant instead of silent drop.
  if (rawLogo && !storeDetails.logoDataUrl) {
    return Response.json(
      {
        saved: false,
        error:
          "Logo could not be saved. Use PNG, JPG, or WebP under 1 MB.",
      },
      { status: 400 },
    );
  }

  const saved = await saveStoreDetailsForShop(session.shop, storeDetails);
  await markSetupGuideStep(session.shop, "store-details");
  return { saved: true, section: "store-details" as const, storeDetails: saved };
}

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const initialSection = parseSettingsSection(requestedSection);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(initialSection);
  const [emailTemplatesNavOpen, setEmailTemplatesNavOpen] = useState(
    isEmailTemplatesSection(initialSection),
  );
  const [storeDetails, setStoreDetails] = useState<StoreDetails>(
    data.storeDetails,
  );
  const [logoError, setLogoError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings>(
    data.smtpSettings,
  );
  const [creditNoteSettings, setCreditNoteSettings] =
    useState<CreditNoteSettings>(data.creditNoteSettings);
  const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings>(
    data.invoiceSettings,
  );
  const [multiCurrencySettings, setMultiCurrencySettings] =
    useState<MultiCurrencySettings>(data.multiCurrencySettings);
  const [downloadLinkTab, setDownloadLinkTab] = useState<
    CustomerDownloadDocumentType | "smart"
  >("smart");
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplatesSettings>(
    data.emailTemplates,
  );
  const emailTemplateKind = emailKindFromSection(activeSection);
  const emailBodyEditorRef = useRef<EmailBodyEditorHandle>(null);
  const [numberSeries, setNumberSeries] = useState<NumberSeriesMap>(
    data.numberSeries,
  );
  const [savedStoreDetails, setSavedStoreDetails] = useState<StoreDetails>(
    data.storeDetails,
  );
  const [savedSmtpSettings, setSavedSmtpSettings] = useState<SmtpSettings>(
    data.smtpSettings,
  );
  const [savedCreditNoteSettings, setSavedCreditNoteSettings] =
    useState<CreditNoteSettings>(data.creditNoteSettings);
  const [savedInvoiceSettings, setSavedInvoiceSettings] =
    useState<InvoiceSettings>(data.invoiceSettings);
  const [savedMultiCurrencySettings, setSavedMultiCurrencySettings] =
    useState<MultiCurrencySettings>(data.multiCurrencySettings);
  const [savedEmailTemplates, setSavedEmailTemplates] =
    useState<EmailTemplatesSettings>(data.emailTemplates);
  const [savedNumberSeries, setSavedNumberSeries] = useState<NumberSeriesMap>(
    data.numberSeries,
  );
  const [lastAllocatedSequence, setLastAllocatedSequence] = useState<
    number | null
  >(data.lastAllocatedSequence);
  const [lastAllocatedByModule, setLastAllocatedByModule] = useState<
    Record<NumberSeriesModuleId, number | null>
  >(data.lastAllocatedByModule);
  const [invoiceDigitWidth, setInvoiceDigitWidth] = useState(
    data.invoiceDigitWidth,
  );
  const [previewDrafts, setPreviewDrafts] = useState<
    Partial<Record<NumberSeriesModuleId, string>>
  >({});
  const [isStoreDirty, setIsStoreDirty] = useState(false);
  const [isSmtpDirty, setIsSmtpDirty] = useState(false);
  const [isCreditNoteDirty, setIsCreditNoteDirty] = useState(false);
  const [isMultiCurrencyDirty, setIsMultiCurrencyDirty] = useState(false);
  const [isEmailTemplatesDirty, setIsEmailTemplatesDirty] = useState(false);
  const [isNumberSeriesDirty, setIsNumberSeriesDirty] = useState(false);
  const [isEditingSeries, setIsEditingSeries] = useState(false);
  const [smtpHelpOpen, setSmtpHelpOpen] = useState(false);
  const [smtpHelpProvider, setSmtpHelpProvider] = useState<
    "gmail" | "webmail"
  >("gmail");
  const [hasSmtpPassword, setHasSmtpPassword] = useState(
    Boolean(data.hasSmtpPassword),
  );
  const [draggingFieldIndex, setDraggingFieldIndex] = useState<number | null>(
    null,
  );
  const [dragOverFieldIndex, setDragOverFieldIndex] = useState<number | null>(
    null,
  );
  const handledFetcherDataRef = useRef<unknown>(null);
  const isSaving = fetcher.state !== "idle";
  const isDirty =
    activeSection === "store-details"
      ? isStoreDirty
      : activeSection === "smtp"
        ? isSmtpDirty
        : activeSection === "credit-notes"
          ? isCreditNoteDirty
          : activeSection === "multi-currency"
            ? isMultiCurrencyDirty
            : isEmailTemplatesSection(activeSection)
              ? isEmailTemplatesDirty
              : isNumberSeriesDirty;
  const activeEmailChild =
    EMAIL_TEMPLATE_SECTIONS.find((item) => item.id === activeSection) ?? null;
  const activeItem = (() => {
    if (activeEmailChild) {
      return {
        id: activeEmailChild.id,
        label: `Email · ${activeEmailChild.label}`,
        description: activeEmailChild.description,
        icon: "note" as const,
      };
    }
    const top = settingsMenu.find(
      (item): item is SettingsMenuItem =>
        "description" in item && item.id === activeSection,
    );
    return top ?? (settingsMenu[0] as SettingsMenuItem);
  })();

  const emailPreview = useMemo(() => {
    const sampleNumber =
      emailTemplateKind === "invoice"
        ? "INV-0007"
        : emailTemplateKind === "draft"
          ? "DFT-0003"
          : emailTemplateKind === "credit-note"
            ? "CN-0003"
            : emailTemplateKind === "packing-slip"
              ? "PS-0002"
              : emailTemplateKind === "return"
                ? "RET-0002"
                : "SO-0007";
    const vars = {
      documentType: documentKindLabel(emailTemplateKind),
      documentNumber: sampleNumber,
      orderName: "#1008",
      customerName: "Alex Customer",
      total: "1,417.94",
      currency: "USD",
      storeName: storeDetails.name.trim() || "Your store",
      referenceNumber: "SO-0007",
    };
    const template = emailTemplates.templates[emailTemplateKind];
    return {
      subject: applyEmailTemplateVars(template.subject, vars),
      bodyText: applyEmailTemplateVars(template.body, vars),
      storeName: vars.storeName,
      documentType: vars.documentType,
      documentNumber: vars.documentNumber,
      amountLabel: [vars.currency, vars.total].filter(Boolean).join(" "),
      attachPdf: template.attachPdf,
      design: emailTemplates.design,
    };
  }, [emailTemplateKind, emailTemplates, storeDetails.name]);

  useEffect(() => {
    const next = parseSettingsSection(requestedSection);
    setActiveSection((current) => (current === next ? current : next));
    if (next !== "number-series") {
      setIsEditingSeries(false);
    }
  }, [requestedSection]);

  useEffect(() => {
    setStoreDetails(data.storeDetails);
    setSavedStoreDetails(data.storeDetails);
    setIsStoreDirty(false);
  }, [data.storeDetails]);

  useEffect(() => {
    setSmtpSettings(data.smtpSettings);
    setSavedSmtpSettings(data.smtpSettings);
    setHasSmtpPassword(Boolean(data.hasSmtpPassword));
    setIsSmtpDirty(false);
  }, [data.smtpSettings, data.hasSmtpPassword]);

  useEffect(() => {
    setCreditNoteSettings(data.creditNoteSettings);
    setSavedCreditNoteSettings(data.creditNoteSettings);
    setInvoiceSettings(data.invoiceSettings);
    setSavedInvoiceSettings(data.invoiceSettings);
    setIsCreditNoteDirty(false);
  }, [data.creditNoteSettings, data.invoiceSettings]);

  useEffect(() => {
    setMultiCurrencySettings(data.multiCurrencySettings);
    setSavedMultiCurrencySettings(data.multiCurrencySettings);
    setIsMultiCurrencyDirty(false);
  }, [data.multiCurrencySettings]);

  useEffect(() => {
    setEmailTemplates(data.emailTemplates);
    setSavedEmailTemplates(data.emailTemplates);
    setIsEmailTemplatesDirty(false);
  }, [data.emailTemplates]);

  useEffect(() => {
    setNumberSeries(data.numberSeries);
    setSavedNumberSeries(data.numberSeries);
    setLastAllocatedSequence(data.lastAllocatedSequence);
    setLastAllocatedByModule(data.lastAllocatedByModule);
    setInvoiceDigitWidth(data.invoiceDigitWidth);
    setIsNumberSeriesDirty(false);
    setIsEditingSeries(false);
  }, [
    data.numberSeries,
    data.lastAllocatedSequence,
    data.lastAllocatedByModule,
    data.invoiceDigitWidth,
  ]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (handledFetcherDataRef.current === fetcher.data) return;
    handledFetcherDataRef.current = fetcher.data;

    if ("error" in fetcher.data && fetcher.data.error) {
      if (typeof shopify !== "undefined" && shopify.toast) {
        shopify.toast.show(String(fetcher.data.error), { isError: true });
      }
      return;
    }

    if (!("saved" in fetcher.data) || !fetcher.data.saved) {
      return;
    }

    if ("storeDetails" in fetcher.data && fetcher.data.storeDetails) {
      setStoreDetails(fetcher.data.storeDetails);
      setSavedStoreDetails(fetcher.data.storeDetails);
      setIsStoreDirty(false);
    }

    if ("smtpSettings" in fetcher.data && fetcher.data.smtpSettings) {
      setSmtpSettings(fetcher.data.smtpSettings);
      setSavedSmtpSettings(fetcher.data.smtpSettings);
      setIsSmtpDirty(false);
      if ("hasSmtpPassword" in fetcher.data) {
        setHasSmtpPassword(Boolean(fetcher.data.hasSmtpPassword));
      }
    }

    if (
      "creditNoteSettings" in fetcher.data &&
      fetcher.data.creditNoteSettings
    ) {
      setCreditNoteSettings(fetcher.data.creditNoteSettings);
      setSavedCreditNoteSettings(fetcher.data.creditNoteSettings);
      setIsCreditNoteDirty(false);
    }

    if ("invoiceSettings" in fetcher.data && fetcher.data.invoiceSettings) {
      setInvoiceSettings(fetcher.data.invoiceSettings);
      setSavedInvoiceSettings(fetcher.data.invoiceSettings);
      setIsCreditNoteDirty(false);
    }

    if (
      "multiCurrencySettings" in fetcher.data &&
      fetcher.data.multiCurrencySettings
    ) {
      setMultiCurrencySettings(fetcher.data.multiCurrencySettings);
      setSavedMultiCurrencySettings(fetcher.data.multiCurrencySettings);
      setIsMultiCurrencyDirty(false);
    }

    if ("emailTemplates" in fetcher.data && fetcher.data.emailTemplates) {
      setEmailTemplates(fetcher.data.emailTemplates);
      setSavedEmailTemplates(fetcher.data.emailTemplates);
      setIsEmailTemplatesDirty(false);
    }

    if ("numberSeries" in fetcher.data && fetcher.data.numberSeries) {
      setNumberSeries(fetcher.data.numberSeries);
      setSavedNumberSeries(fetcher.data.numberSeries);
      setIsNumberSeriesDirty(false);
      setIsEditingSeries(false);
      setPreviewDrafts({});
      if (
        "lastAllocatedByModule" in fetcher.data &&
        fetcher.data.lastAllocatedByModule
      ) {
        setLastAllocatedByModule(
          fetcher.data.lastAllocatedByModule as Record<
            NumberSeriesModuleId,
            number | null
          >,
        );
      }
      if (
        "lastAllocatedSequence" in fetcher.data &&
        (typeof fetcher.data.lastAllocatedSequence === "number" ||
          fetcher.data.lastAllocatedSequence === null)
      ) {
        setLastAllocatedSequence(fetcher.data.lastAllocatedSequence);
      }
      if (
        "invoiceDigitWidth" in fetcher.data &&
        typeof fetcher.data.invoiceDigitWidth === "number"
      ) {
        setInvoiceDigitWidth(fetcher.data.invoiceDigitWidth);
      }
    }

    if (typeof shopify !== "undefined" && shopify.toast) {
      shopify.toast.show(
        fetcher.data.section === "smtp"
          ? "SMTP settings saved"
          : fetcher.data.section === "credit-notes"
            ? (() => {
                const backfilled =
                  "backfilledCreditNotes" in fetcher.data &&
                  typeof fetcher.data.backfilledCreditNotes === "number"
                    ? fetcher.data.backfilledCreditNotes
                    : 0;
                if (backfilled > 0) {
                  return `Credit note settings saved · created ${backfilled} missing credit note${backfilled === 1 ? "" : "s"}`;
                }
                return "Credit note settings saved";
              })()
            : fetcher.data.section === "multi-currency"
              ? "Multi currency settings saved"
              : fetcher.data.section === "email-templates"
                ? "Email templates saved"
                : fetcher.data.section === "number-series"
                  ? "Transaction numbers saved"
                  : fetcher.data.section === "store-details" &&
                      "storeDetails" in fetcher.data
                    ? "Store details saved"
                    : "Settings saved",
      );
    }
  }, [fetcher.state, fetcher.data]);

  const updateField = (
    key: Exclude<keyof StoreDetails, "customFields">,
    value: string,
  ) => {
    setStoreDetails((current) => ({ ...current, [key]: value }));
    setIsStoreDirty(true);
  };

  const uploadStoreLogo = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setLogoError("Logo must be smaller than 1 MB.");
      return;
    }
    const allowed = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
    if (file.type && !allowed.has(file.type.toLowerCase())) {
      setLogoError("Logo must be PNG, JPG, or WebP.");
      return;
    }
    setLogoError("");
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      const logoDataUrl = normalizeStoreLogoDataUrl(reader.result);
      if (!logoDataUrl) {
        setLogoError(
          "Could not read this logo. Use PNG, JPG, or WebP under 1 MB.",
        );
        return;
      }
      setStoreDetails((current) => ({
        ...current,
        logoDataUrl,
        logoFileName: file.name,
      }));
      setIsStoreDirty(true);
    });
    reader.addEventListener("error", () => {
      setLogoError("Could not read this logo file.");
    });
    reader.readAsDataURL(file);
  };

  const updateSmtpField = <K extends keyof SmtpSettings>(
    key: K,
    value: SmtpSettings[K],
  ) => {
    setSmtpSettings((current) => ({ ...current, [key]: value }));
    setIsSmtpDirty(true);
  };

  const applyGmailSmtpPreset = () => {
    setSmtpSettings((current) => ({
      ...current,
      ...GMAIL_SMTP_PRESET,
    }));
    setSmtpHelpProvider("gmail");
    setIsSmtpDirty(true);
  };

  const applyWebmailSmtpPreset = () => {
    setSmtpSettings((current) => ({
      ...current,
      ...WEBMAIL_SMTP_PRESET,
    }));
    setSmtpHelpProvider("webmail");
    setSmtpHelpOpen(true);
    setIsSmtpDirty(true);
  };

  const updateEmailDesign = <K extends keyof EmailTemplatesSettings["design"]>(
    key: K,
    value: EmailTemplatesSettings["design"][K],
  ) => {
    setEmailTemplates((current) => ({
      ...current,
      design: { ...current.design, [key]: value },
    }));
    setIsEmailTemplatesDirty(true);
  };

  const updateEmailTemplateField = <K extends keyof EmailTemplatesSettings["templates"]["invoice"]>(
    key: K,
    value: EmailTemplatesSettings["templates"]["invoice"][K],
  ) => {
    setEmailTemplates((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [emailTemplateKind]: {
          ...current.templates[emailTemplateKind],
          [key]: value,
        },
      },
    }));
    setIsEmailTemplatesDirty(true);
  };

  const resetEmailTemplateToDefault = () => {
    const next = getDefaultEmailTemplate(emailTemplateKind);
    setEmailTemplates((current) => ({
      ...current,
      templates: {
        ...current.templates,
        [emailTemplateKind]: next,
      },
    }));
    setIsEmailTemplatesDirty(true);
  };

  const loadAllReadyEmailTemplates = () => {
    setEmailTemplates((current) => ({
      ...current,
      templates: getReadyEmailTemplates(),
      readySetVersion: EMAIL_TEMPLATES_READY_SET_VERSION,
    }));
    setIsEmailTemplatesDirty(true);
  };

  const updateSeriesEntry = (
    moduleId: NumberSeriesModuleId,
    updates: Partial<NumberSeriesEntry>,
  ) => {
    setNumberSeries((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        ...updates,
        ...(updates.startingNumber != null
          ? {
              startingNumber: String(updates.startingNumber).replace(/\D/g, ""),
            }
          : {}),
      },
    }));
    setIsNumberSeriesDirty(true);
  };

  const applyPreviewDraft = (moduleId: NumberSeriesModuleId, raw: string) => {
    setPreviewDrafts((current) => ({ ...current, [moduleId]: raw }));
    setIsNumberSeriesDirty(true);
    const entry = numberSeries[moduleId];
    const parsed =
      parseNumberSeriesDigits(raw.trim(), entry) ||
      parseNumberSeriesDigits(
        `${entry.prefix}${raw.trim()}${entry.suffix ?? ""}`,
        entry,
      );
    if (!parsed) return;

    // Keep the merchant's typed sequence even if already used — Save rejects it.
    const nextSequence = parsed.sequence;
    const width = Math.max(
      parsed.digitWidth,
      moduleId === "invoice" ? invoiceDigitWidth : 0,
      entry.startingNumber.length,
    );
    const startingNumber = widenStartingNumberPad(entry.startingNumber, width);
    if (moduleId === "invoice") {
      setInvoiceDigitWidth((prev) => Math.max(prev, width));
    }
    setNumberSeries((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        nextSequence,
        startingNumber,
      },
    }));
  };

  const commitPreviewDraft = (moduleId: NumberSeriesModuleId) => {
    const entry = numberSeries[moduleId];
    const label =
      typeof entry.nextSequence === "number" &&
      Number.isFinite(entry.nextSequence)
        ? formatNumberSeriesValue(entry, entry.nextSequence)
        : previewForModule(moduleId);
    setPreviewDrafts((current) => ({
      ...current,
      [moduleId]: label,
    }));
  };

  const updateCustomField = (
    id: string,
    updates: Partial<Pick<StoreCustomField, "label" | "value">>,
  ) => {
    setStoreDetails((current) => ({
      ...current,
      customFields: current.customFields.map((field) =>
        field.id === id ? { ...field, ...updates } : field,
      ),
    }));
    setIsStoreDirty(true);
  };

  const addCustomField = () => {
    setStoreDetails((current) => ({
      ...current,
      customFields: [...current.customFields, createStoreCustomField()],
    }));
    setIsStoreDirty(true);
  };

  const removeCustomField = (id: string) => {
    setStoreDetails((current) => ({
      ...current,
      customFields: current.customFields.filter((field) => field.id !== id),
    }));
    setIsStoreDirty(true);
  };

  const moveCustomField = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= storeDetails.customFields.length ||
      toIndex >= storeDetails.customFields.length
    ) {
      return;
    }

    setStoreDetails((current) => {
      const next = [...current.customFields];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...current, customFields: next };
    });
    setIsStoreDirty(true);
  };

  const save = () => {
    if (activeSection === "smtp") {
      fetcher.submit(
        {
          intent: "save-smtp",
          smtpSettings: JSON.stringify(smtpSettings),
        },
        { method: "post" },
      );
      return;
    }

    if (activeSection === "credit-notes") {
      fetcher.submit(
        {
          intent: "save-credit-notes",
          creditNoteSettings: JSON.stringify(creditNoteSettings),
          invoiceSettings: JSON.stringify(invoiceSettings),
        },
        { method: "post" },
      );
      return;
    }

    if (activeSection === "multi-currency") {
      fetcher.submit(
        {
          intent: "save-multi-currency",
          multiCurrencySettings: JSON.stringify(multiCurrencySettings),
        },
        { method: "post" },
      );
      return;
    }

    if (isEmailTemplatesSection(activeSection)) {
      fetcher.submit(
        {
          intent: "save-email-templates",
          emailTemplates: JSON.stringify(emailTemplates),
        },
        { method: "post" },
      );
      return;
    }

    if (activeSection === "number-series") {
      const conflictError = getNumberSeriesAlreadyUsedError(
        numberSeries,
        savedNumberSeries,
        lastAllocatedByModule,
      );
      if (conflictError) {
        if (typeof shopify !== "undefined" && shopify.toast) {
          shopify.toast.show(conflictError, { isError: true });
        }
        return;
      }
      fetcher.submit(
        {
          intent: "save-number-series",
          numberSeries: JSON.stringify(numberSeries),
        },
        { method: "post" },
      );
      return;
    }

    fetcher.submit(
      {
        intent: "save-store-details",
        storeDetails: JSON.stringify(storeDetails),
      },
      { method: "post" },
    );
  };

  const discard = () => {
    if (activeSection === "smtp") {
      setSmtpSettings(savedSmtpSettings);
      setIsSmtpDirty(false);
      return;
    }
    if (activeSection === "credit-notes") {
      setCreditNoteSettings(savedCreditNoteSettings);
      setInvoiceSettings(savedInvoiceSettings);
      setIsCreditNoteDirty(false);
      return;
    }
    if (activeSection === "multi-currency") {
      setMultiCurrencySettings(savedMultiCurrencySettings);
      setIsMultiCurrencyDirty(false);
      return;
    }
    if (isEmailTemplatesSection(activeSection)) {
      setEmailTemplates(savedEmailTemplates);
      setIsEmailTemplatesDirty(false);
      return;
    }
    if (activeSection === "number-series") {
      setNumberSeries(savedNumberSeries);
      setIsNumberSeriesDirty(false);
      setIsEditingSeries(false);
      setPreviewDrafts({});
      setInvoiceDigitWidth(data.invoiceDigitWidth);
      return;
    }
    setStoreDetails(savedStoreDetails);
    setIsStoreDirty(false);
  };

  const resetFromShopify = () => {
    fetcher.submit({ intent: "reset" }, { method: "post" });
  };

  const switchSection = (section: SettingsSection) => {
    const stayingInEmail =
      isEmailTemplatesSection(activeSection) &&
      isEmailTemplatesSection(section);
    if (isDirty && section !== activeSection && !stayingInEmail) {
      discard();
    }
    setActiveSection(section);
    if (section !== "number-series") {
      setIsEditingSeries(false);
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (section === "store-details") {
          next.delete("section");
        } else {
          next.set("section", section);
        }
        return next;
      },
      { replace: true },
    );
  };

  const previewForModule = (moduleId: NumberSeriesModuleId) => {
    const entry = numberSeries[moduleId];
    const last = lastAllocatedByModule[moduleId] ?? null;
    const padded =
      moduleId === "invoice"
        ? {
            ...entry,
            startingNumber: widenStartingNumberPad(
              entry.startingNumber,
              Math.max(invoiceDigitWidth, entry.startingNumber.length),
            ),
          }
        : entry;
    // While editing, show the merchant's typed next number even if already used.
    if (
      isEditingSeries &&
      typeof padded.nextSequence === "number" &&
      Number.isFinite(padded.nextSequence)
    ) {
      return formatNumberSeriesValue(padded, padded.nextSequence);
    }
    return formatNumberSeriesNextPreview(padded, last);
  };

  const beginEditingSeries = () => {
    const drafts: Partial<Record<NumberSeriesModuleId, string>> = {};
    for (const module of NUMBER_SERIES_MODULES) {
      drafts[module.id] = previewForModule(module.id);
    }
    setPreviewDrafts(drafts);
    setIsEditingSeries(true);
  };

  const mainCardHeading =
    activeSection === "store-details"
      ? "Store details"
      : activeSection === "number-series"
        ? "Transaction numbers"
        : activeSection === "credit-notes"
          ? "Advanced"
          : activeSection === "multi-currency"
            ? "Multi Currency"
            : activeSection === "download-links"
              ? "Download links"
          : activeSection === "smtp"
            ? "SMTP"
            : `Email · ${activeEmailChild?.label ?? "Template"}`;

  return (
    <>
      <SaveBar id="settings-save-bar" open={isDirty} discardConfirmation>
        <button
          variant="primary"
          onClick={save}
          disabled={!isDirty || isSaving || undefined}
          loading={isSaving || undefined}
        >
          {isSaving ? "Saving…" : "Save"}
        </button>
        <button onClick={discard} disabled={isSaving || undefined}>
          Discard
        </button>
      </SaveBar>

      <AppProvider i18n={enTranslations}>
        <Page
          title="Settings"
          fullWidth
          secondaryActions={
            activeSection === "store-details"
              ? [
                  {
                    content: "Load from Shopify store",
                    onAction: resetFromShopify,
                    disabled: isSaving,
                  },
                ]
              : undefined
          }
        >
          <BlockStack gap="400">
            <div
              className={`settings-page${
                isEmailTemplatesSection(activeSection)
                  ? " settings-page--with-preview"
                  : activeSection === "multi-currency" ||
                      activeSection === "download-links"
                    ? " settings-page--with-recommend settings-page--multi-currency"
                    : " settings-page--with-recommend"
              }`}
              onKeyDown={stopInputShortcutPropagation}
            >
              <Layout>
                <Layout.Section variant="oneThird">
                  <div className="settings-nav-column">
                  <Card padding="0">
                    <nav className="settings-nav" aria-label="Settings sections">
                      {settingsMenu.map((item) => {
                        if ("children" in item) {
                          const groupActive = isEmailTemplatesSection(
                            activeSection,
                          );
                          return (
                            <div key={item.id} className="settings-nav__group">
                              <button
                                type="button"
                                className={`settings-nav-item settings-nav-item--group${
                                  groupActive ? " settings-nav-item--active" : ""
                                }`}
                                aria-expanded={emailTemplatesNavOpen}
                                onClick={() => {
                                  if (emailTemplatesNavOpen) {
                                    setEmailTemplatesNavOpen(false);
                                    return;
                                  }
                                  setEmailTemplatesNavOpen(true);
                                  if (!groupActive) {
                                    switchSection(item.children[0].id);
                                  }
                                }}
                              >
                                <Icon
                                  source={SETTINGS_MENU_ICONS[item.icon]}
                                  tone={groupActive ? "base" : "subdued"}
                                />
                                <Text as="span" fontWeight="semibold">
                                  {item.label}
                                </Text>
                                <span className="settings-nav-item__chevron">
                                  <Icon
                                    source={
                                      emailTemplatesNavOpen
                                        ? ChevronUpIcon
                                        : ChevronDownIcon
                                    }
                                    tone="subdued"
                                  />
                                </span>
                              </button>
                              <Collapsible
                                open={emailTemplatesNavOpen}
                                id="settings-email-templates-nav"
                                transition={{
                                  duration: "150ms",
                                  timingFunction: "ease",
                                }}
                              >
                                {item.children.map((child) => {
                                  const isActive = child.id === activeSection;
                                  return (
                                    <button
                                      key={child.id}
                                      type="button"
                                      className={`settings-nav-item settings-nav-item--sub${
                                        isActive
                                          ? " settings-nav-item--active"
                                          : ""
                                      }`}
                                      onClick={() => {
                                        setEmailTemplatesNavOpen(true);
                                        switchSection(child.id);
                                      }}
                                    >
                                      <Text
                                        as="span"
                                        fontWeight={
                                          isActive ? "semibold" : "regular"
                                        }
                                      >
                                        {child.label}
                                      </Text>
                                    </button>
                                  );
                                })}
                              </Collapsible>
                            </div>
                          );
                        }

                        const isActive = item.id === activeSection;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`settings-nav-item${
                              isActive ? " settings-nav-item--active" : ""
                            }`}
                            onClick={() => switchSection(item.id)}
                          >
                            <Icon
                              source={SETTINGS_MENU_ICONS[item.icon]}
                              tone={isActive ? "base" : "subdued"}
                            />
                            <Text
                              as="span"
                              fontWeight={isActive ? "semibold" : "regular"}
                            >
                              {item.label}
                            </Text>
                          </button>
                        );
                      })}
                    </nav>
                  </Card>
                  </div>
                </Layout.Section>

                <Layout.Section>
                  <div className="settings-form-column">
                  {activeSection === "credit-notes" ? (
                    <BlockStack gap="400">
                      <Card>
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h2" variant="headingMd">
                              Credit Note
                            </Text>
                            <Text as="p" tone="subdued">
                              Auto-create when an order is cancelled or
                              refunded. Needs an invoice first.
                            </Text>
                          </BlockStack>

                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                              Automation
                            </Text>
                            <Checkbox
                              label="On cancel"
                              helpText="When the order is cancelled."
                              checked={creditNoteSettings.autoOnCancel}
                              onChange={(checked) => {
                                setCreditNoteSettings((current) => ({
                                  ...current,
                                  autoOnCancel: checked,
                                }));
                                setIsCreditNoteDirty(true);
                              }}
                            />
                            <Checkbox
                              label="On full refund"
                              helpText="When fully refunded."
                              checked={creditNoteSettings.autoOnRefund}
                              onChange={(checked) => {
                                setCreditNoteSettings((current) => ({
                                  ...current,
                                  autoOnRefund: checked,
                                }));
                                setIsCreditNoteDirty(true);
                              }}
                            />
                            <Checkbox
                              label="On partial refund"
                              helpText="When partially refunded."
                              checked={creditNoteSettings.autoOnPartialRefund}
                              onChange={(checked) => {
                                setCreditNoteSettings((current) => ({
                                  ...current,
                                  autoOnPartialRefund: checked,
                                }));
                                setIsCreditNoteDirty(true);
                              }}
                            />
                          </BlockStack>
                        </BlockStack>
                      </Card>

                      <Card>
                        <BlockStack gap="400">
                          <BlockStack gap="100">
                            <Text as="h2" variant="headingMd">
                              Invoice
                            </Text>
                            <Text as="p" tone="subdued">
                              Auto-create when an order is paid in Shopify.
                            </Text>
                          </BlockStack>

                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                              Automation
                            </Text>
                            <Checkbox
                              label="On paid"
                              helpText="Convert to invoice when the order is paid."
                              checked={invoiceSettings.autoOnPaid}
                              onChange={(checked) => {
                                setInvoiceSettings({ autoOnPaid: checked });
                                setIsCreditNoteDirty(true);
                              }}
                            />
                          </BlockStack>
                        </BlockStack>
                      </Card>

                      {isCreditNoteDirty ? (
                        <Text as="p" tone="subdued">
                          Unsaved changes
                        </Text>
                      ) : null}
                    </BlockStack>
                  ) : activeSection === "multi-currency" ? (
                    <BlockStack gap="400">
                      <BlockStack gap="200">
                        <Text as="h2" variant="headingMd">
                          Multi Currency
                        </Text>
                        <Text as="p" tone="subdued">
                          Choose which currency appears on your invoices and
                          other documents.
                        </Text>
                      </BlockStack>

                      <Card>
                        <BlockStack gap="500">
                          <RadioButton
                            label="Off"
                            helpText="Always use your store’s main currency."
                            checked={multiCurrencySettings.mode === "off"}
                            id="multi-currency-off"
                            name="multiCurrency"
                            onChange={(_checked, id) => {
                              if (id !== "multi-currency-off") return;
                              setMultiCurrencySettings({ mode: "off" });
                              setIsMultiCurrencyDirty(true);
                            }}
                          />

                          <RadioButton
                            label="Shopify Multi Currency"
                            helpText="Show the currency the customer paid in at checkout (Shopify Payments)."
                            checked={multiCurrencySettings.mode === "shopify"}
                            id="multi-currency-shopify"
                            name="multiCurrency"
                            onChange={(_checked, id) => {
                              if (id !== "multi-currency-shopify") return;
                              setMultiCurrencySettings({ mode: "shopify" });
                              setIsMultiCurrencyDirty(true);
                            }}
                          />
                        </BlockStack>
                      </Card>

                      {isMultiCurrencyDirty ? (
                        <Text as="p" tone="subdued">
                          Unsaved changes
                        </Text>
                      ) : null}
                    </BlockStack>
                  ) : activeSection === "download-links" ? (
                    <BlockStack gap="400">
                      <BlockStack gap="200">
                        <Text as="h2" variant="headingMd">
                          Automated PDF download links
                        </Text>
                        <Text as="p" tone="subdued">
                          Paste a link into Shopify order notification emails so
                          customers can download the PDF directly.
                        </Text>
                      </BlockStack>

                      <Banner tone="info" title="When can customers download?">
                        <p>
                          Invoice link works only after the order is converted to
                          an invoice in Billoxi (paid orders). COD and custom
                          payment orders should use the Sales Order link until
                          then. If a document is not converted yet, the customer
                          sees a notice instead of a PDF.
                        </p>
                      </Banner>

                      <Card>
                        <BlockStack gap="400">
                          <Tabs
                            tabs={[
                              { id: "smart", content: "Recommended" },
                              ...CUSTOMER_DOWNLOAD_DOCUMENT_TYPES.map(
                                (item) => ({
                                  id: item.id,
                                  content: item.label,
                                }),
                              ),
                            ]}
                            selected={
                              downloadLinkTab === "smart"
                                ? 0
                                : Math.max(
                                    0,
                                    CUSTOMER_DOWNLOAD_DOCUMENT_TYPES.findIndex(
                                      (item) => item.id === downloadLinkTab,
                                    ),
                                  ) + 1
                            }
                            onSelect={(index) => {
                              if (index <= 0) {
                                setDownloadLinkTab("smart");
                                return;
                              }
                              const next =
                                CUSTOMER_DOWNLOAD_DOCUMENT_TYPES[index - 1]
                                  ?.id || "sales-order";
                              setDownloadLinkTab(next);
                            }}
                          />

                          <Text as="p" tone="subdued">
                            {downloadLinkTab === "smart"
                              ? "Paid → invoice link. COD / custom / unpaid → sales order link."
                              : downloadLinkTab === "invoice"
                                ? "Shows only when the order is paid. Download works after invoice convert in Billoxi."
                                : downloadLinkTab === "sales-order"
                                  ? "Shows for unpaid orders (COD / custom). Use until invoice convert."
                                  : "Copy and paste into your Shopify notification email."}{" "}
                            <Link
                              url="shopify://admin/settings/notifications"
                              target="_top"
                              removeUnderline
                            >
                              Open notification emails
                            </Link>
                          </Text>

                          <TextField
                            label="Liquid snippet"
                            labelHidden
                            value={
                              (downloadLinkTab === "smart"
                                ? data.downloadLinkSnippets.smart
                                : data.downloadLinkSnippets[downloadLinkTab]) ||
                              ""
                            }
                            onChange={() => undefined}
                            multiline={6}
                            autoComplete="off"
                            monospaced
                            readOnly
                            selectTextOnFocus
                          />

                          <InlineStack gap="200">
                            <Button
                              variant="primary"
                              onClick={async () => {
                                const snippet =
                                  (downloadLinkTab === "smart"
                                    ? data.downloadLinkSnippets.smart
                                    : data.downloadLinkSnippets[
                                        downloadLinkTab
                                      ]) || "";
                                try {
                                  await navigator.clipboard.writeText(snippet);
                                  if (
                                    typeof shopify !== "undefined" &&
                                    shopify.toast
                                  ) {
                                    shopify.toast.show("Copied to clipboard");
                                  }
                                } catch {
                                  if (
                                    typeof shopify !== "undefined" &&
                                    shopify.toast
                                  ) {
                                    shopify.toast.show("Couldn’t copy", {
                                      isError: true,
                                    });
                                  }
                                }
                              }}
                            >
                              Copy code
                            </Button>
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    </BlockStack>
                  ) : (
                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingMd">
                        {mainCardHeading}
                      </Text>

                      {activeSection === "store-details" ? (
                        <BlockStack gap="400">
                          <Text as="p" tone="subdued">
                            {activeItem.description}
                          </Text>

                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                              Store logo
                            </Text>
                            <Text as="p" tone="subdued">
                              Used on every sales order, invoice, credit note,
                              and packing slip template. Upload a logo, then
                              click Save. Set size per template in Templates →
                              Edit → Transaction details.
                            </Text>
                            {logoError ? (
                              <Banner tone="critical" onDismiss={() => setLogoError("")}>
                                {logoError}
                              </Banner>
                            ) : null}
                            {storeDetails.logoDataUrl ? (
                              <InlineStack gap="300" blockAlign="center" wrap={false}>
                                <Thumbnail
                                  source={storeDetails.logoDataUrl}
                                  alt={storeDetails.logoFileName || "Store logo"}
                                  size="medium"
                                />
                                <BlockStack gap="200">
                                  <InlineStack gap="200">
                                    <Button
                                      onClick={() => logoInputRef.current?.click()}
                                    >
                                      Change logo
                                    </Button>
                                    <Button
                                      tone="critical"
                                      variant="plain"
                                      onClick={() => {
                                        setStoreDetails((current) => {
                                          const next = { ...current };
                                          delete next.logoDataUrl;
                                          delete next.logoFileName;
                                          return next;
                                        });
                                        setIsStoreDirty(true);
                                        setLogoError("");
                                      }}
                                    >
                                      Remove
                                    </Button>
                                  </InlineStack>
                                  <Text as="p" tone="subdued" variant="bodySm">
                                    {storeDetails.logoFileName || "PNG, JPG, or WebP"}
                                  </Text>
                                </BlockStack>
                              </InlineStack>
                            ) : (
                              <DropZone
                                accept="image/png,image/jpeg,image/webp"
                                allowMultiple={false}
                                type="image"
                                onDropAccepted={uploadStoreLogo}
                                onDropRejected={() =>
                                  setLogoError(
                                    "Upload a PNG, JPG, or WebP image smaller than 1 MB.",
                                  )
                                }
                              >
                                <DropZone.FileUpload
                                  actionTitle="Upload logo"
                                  actionHint="PNG, JPG, or WebP · Maximum 1 MB"
                                />
                              </DropZone>
                            )}
                            <input
                              ref={logoInputRef}
                              accept="image/png,image/jpeg,image/webp"
                              type="file"
                              hidden
                              onChange={(event) => {
                                uploadStoreLogo(
                                  event.currentTarget.files
                                    ? Array.from(event.currentTarget.files)
                                    : [],
                                );
                                event.currentTarget.value = "";
                              }}
                            />
                          </BlockStack>

                          <Divider />

                          <TextField
                            label="Store / organization name"
                            value={storeDetails.name}
                            onChange={(value) => updateField("name", value)}
                            autoComplete="organization"
                          />

                          <TextField
                            label="Address"
                            value={storeDetails.address}
                            multiline={4}
                            onChange={(value) => updateField("address", value)}
                            autoComplete="street-address"
                            helpText="Type the full address. Use a new line for each address line."
                          />

                          <InlineStack gap="300" wrap={false}>
                            <div className="settings-flex-field">
                              <TextField
                                label="Phone"
                                value={storeDetails.phone}
                                onChange={(value) => updateField("phone", value)}
                                autoComplete="off"
                              />
                            </div>
                            <div className="settings-flex-field">
                              <TextField
                                label="Email"
                                type="email"
                                value={storeDetails.email}
                                onChange={(value) => updateField("email", value)}
                                autoComplete="email"
                              />
                            </div>
                          </InlineStack>

                          <TextField
                            label="Website"
                            value={storeDetails.website}
                            onChange={(value) => updateField("website", value)}
                            autoComplete="off"
                            helpText="Shown on document headers as Website: www.your-site.com"
                          />

                          <Divider />

                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">
                              Custom fields
                            </Text>
                            <Button onClick={addCustomField}>Add field</Button>
                          </InlineStack>

                          {storeDetails.customFields.length === 0 ? (
                            <Text as="p" tone="subdued">
                              No custom fields yet.
                            </Text>
                          ) : (
                            <BlockStack gap="200">
                              <Text as="p" tone="subdued">
                                Drag to reorder fields.
                              </Text>
                              <div className="settings-custom-fields">
                                {storeDetails.customFields.map((field, index) => {
                                  const isDragging = draggingFieldIndex === index;
                                  const isDropTarget =
                                    dragOverFieldIndex === index &&
                                    draggingFieldIndex !== index;
                                  const isLast =
                                    index === storeDetails.customFields.length - 1;

                                  return (
                                    <div
                                      key={field.id}
                                      className={[
                                        "settings-custom-field",
                                        isDragging
                                          ? "settings-custom-field--dragging"
                                          : "",
                                        isDropTarget
                                          ? "settings-custom-field--drop-target"
                                          : "",
                                        isLast ? "settings-custom-field--last" : "",
                                      ]
                                        .filter(Boolean)
                                        .join(" ")}
                                      onDragOver={(event) => {
                                        event.preventDefault();
                                        if (dragOverFieldIndex !== index) {
                                          setDragOverFieldIndex(index);
                                        }
                                      }}
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        if (draggingFieldIndex !== null) {
                                          moveCustomField(draggingFieldIndex, index);
                                        }
                                        setDraggingFieldIndex(null);
                                        setDragOverFieldIndex(null);
                                      }}
                                    >
                                      <InlineStack
                                        gap="200"
                                        blockAlign="center"
                                        wrap={false}
                                      >
                                        <div
                                          className="settings__drag-handle"
                                          draggable
                                          role="button"
                                          tabIndex={0}
                                          aria-label={`Drag to reorder ${field.label || "custom field"}`}
                                          onDragStart={(event) => {
                                            event.dataTransfer.effectAllowed =
                                              "move";
                                            event.dataTransfer.setData(
                                              "text/plain",
                                              String(index),
                                            );
                                            setDraggingFieldIndex(index);
                                          }}
                                          onDragEnd={() => {
                                            setDraggingFieldIndex(null);
                                            setDragOverFieldIndex(null);
                                          }}
                                        >
                                          <Icon
                                            source={DragHandleIcon}
                                            tone="subdued"
                                          />
                                        </div>
                                        <div className="settings-custom-field__input">
                                          <TextField
                                            label="Label"
                                            labelHidden
                                            value={field.label}
                                            placeholder="Label"
                                            onChange={(value) =>
                                              updateCustomField(field.id, {
                                                label: value,
                                              })
                                            }
                                            autoComplete="off"
                                          />
                                        </div>
                                        <div className="settings-custom-field__input">
                                          <TextField
                                            label="Text"
                                            labelHidden
                                            value={field.value}
                                            placeholder="Text"
                                            onChange={(value) =>
                                              updateCustomField(field.id, { value })
                                            }
                                            autoComplete="off"
                                          />
                                        </div>
                                        <Button
                                          variant="tertiary"
                                          tone="critical"
                                          onClick={() => removeCustomField(field.id)}
                                        >
                                          Remove
                                        </Button>
                                      </InlineStack>
                                    </div>
                                  );
                                })}
                              </div>
                            </BlockStack>
                          )}

                          {isStoreDirty ? (
                            <Text as="p" tone="subdued">
                              Unsaved changes
                            </Text>
                          ) : null}
                        </BlockStack>
                      ) : activeSection === "number-series" ? (
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" tone="subdued">
                              {activeItem.description}
                            </Text>
                            {isEditingSeries ? (
                              <Button
                                onClick={() => {
                                  setNumberSeries(savedNumberSeries);
                                  setIsNumberSeriesDirty(false);
                                  setIsEditingSeries(false);
                                  setPreviewDrafts({});
                                  setInvoiceDigitWidth(data.invoiceDigitWidth);
                                }}
                                disabled={isSaving}
                              >
                                Cancel
                              </Button>
                            ) : (
                              <Button icon={EditIcon} onClick={beginEditingSeries}>
                                Edit
                              </Button>
                            )}
                          </InlineStack>

                          <DataTable
                            columnContentTypes={["text", "text", "text", "text"]}
                            headings={["Module", "Prefix", "Starting number", "Preview"]}
                            rows={NUMBER_SERIES_MODULES.map((module) => {
                              const entry = numberSeries[module.id];
                              return [
                                <Text as="span" fontWeight="semibold" key={`label-${module.id}`}>
                                  {module.label}
                                </Text>,
                                isEditingSeries ? (
                                  <TextField
                                    key={`prefix-${module.id}`}
                                    label="Prefix"
                                    labelHidden
                                    value={entry.prefix}
                                    onChange={(value) =>
                                      updateSeriesEntry(module.id, { prefix: value })
                                    }
                                    autoComplete="off"
                                  />
                                ) : (
                                  entry.prefix || "—"
                                ),
                                isEditingSeries ? (
                                  <TextField
                                    key={`start-${module.id}`}
                                    label="Starting number"
                                    labelHidden
                                    value={entry.startingNumber}
                                    onChange={(value) =>
                                      updateSeriesEntry(module.id, {
                                        startingNumber: value,
                                      })
                                    }
                                    autoComplete="off"
                                  />
                                ) : (
                                  entry.startingNumber
                                ),
                                isEditingSeries ? (
                                  <TextField
                                    key={`preview-${module.id}`}
                                    label="Preview / next number"
                                    labelHidden
                                    value={
                                      previewDrafts[module.id] ??
                                      previewForModule(module.id)
                                    }
                                    onChange={(value) =>
                                      applyPreviewDraft(module.id, value)
                                    }
                                    onBlur={() => commitPreviewDraft(module.id)}
                                    autoComplete="off"
                                  />
                                ) : (
                                  <Text
                                    as="span"
                                    fontWeight="semibold"
                                    key={`preview-text-${module.id}`}
                                  >
                                    {previewForModule(module.id)}
                                  </Text>
                                ),
                              ];
                            })}
                          />

                          {isNumberSeriesDirty ? (
                            <Text as="p" tone="subdued">
                              Unsaved changes
                            </Text>
                          ) : null}

                          <Divider />

                          <Banner tone="info">
                            <p>
                              Numbers for existing Shopify orders, invoices,
                              drafts, and returns are assigned automatically
                              when the app is installed. Save Prefix and
                              Starting number above for new documents.
                            </p>
                          </Banner>
                        </BlockStack>
                      ) : activeSection === "smtp" ? (
                        <BlockStack gap="400">
                          <Text as="p" tone="subdued">
                            {activeItem.description}
                          </Text>

                          <Box
                            borderWidth="025"
                            borderColor="border"
                            borderRadius="200"
                            background="bg-surface-secondary"
                            width="100%"
                          >
                            <button
                              type="button"
                              className="settings-smtp-help__toggle"
                              aria-expanded={smtpHelpOpen}
                              aria-controls="smtp-help-collapsible"
                              onClick={() => setSmtpHelpOpen((open) => !open)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                width: "100%",
                                boxSizing: "border-box",
                              }}
                            >
                              <Text as="span" fontWeight="semibold">
                                How to set up SMTP
                              </Text>
                              <span className="settings-smtp-help__toggle-icon">
                                <Icon
                                  source={
                                    smtpHelpOpen ? ChevronUpIcon : ChevronDownIcon
                                  }
                                />
                              </span>
                            </button>
                            <Collapsible id="smtp-help-collapsible" open={smtpHelpOpen}>
                              <Box padding="300" paddingBlockStart="0">
                                <BlockStack gap="300">
                                  <InlineStack gap="200">
                                    <Button
                                      size="slim"
                                      pressed={smtpHelpProvider === "gmail"}
                                      onClick={() => setSmtpHelpProvider("gmail")}
                                    >
                                      Gmail
                                    </Button>
                                    <Button
                                      size="slim"
                                      pressed={smtpHelpProvider === "webmail"}
                                      onClick={() => setSmtpHelpProvider("webmail")}
                                    >
                                      Webmail / custom domain
                                    </Button>
                                  </InlineStack>

                                  {smtpHelpProvider === "gmail" ? (
                                    <ol className="settings-help-list">
                                      <li>
                                        Click <strong>Use Gmail</strong> below — host,
                                        port 587, and TLS fill automatically.
                                      </li>
                                      <li>
                                        Enter your full Gmail in{" "}
                                        <strong>From email</strong> and{" "}
                                        <strong>Username</strong> (e.g. you@gmail.com).
                                      </li>
                                      <li>
                                        Turn on 2-Step Verification in your Google
                                        Account, then create an{" "}
                                        <strong>App Password</strong>. Use that
                                        password here — not your normal Gmail password.
                                      </li>
                                      <li>
                                        Paste the App Password in the{" "}
                                        <strong>Password</strong> field.
                                      </li>
                                      <li>
                                        Click <strong>Save</strong> at the top of this
                                        page.
                                      </li>
                                    </ol>
                                  ) : (
                                    <ol className="settings-help-list">
                                      <li>
                                        Click <strong>Use Webmail</strong> below —
                                        Hostinger defaults fill automatically
                                        (smtp.hostinger.com, port 465, SSL). Change the
                                        host if you use another provider (e.g.
                                        mail.yourdomain.com or smtp.office365.com).
                                      </li>
                                      <li>
                                        Hostinger: keep port <strong>465</strong> with
                                        TLS off (SSL). For other providers, port{" "}
                                        <strong>587</strong> + Use TLS is common.
                                      </li>
                                      <li>
                                        Fill <strong>From email</strong>,{" "}
                                        <strong>From name</strong>, username (full
                                        email), and mailbox password.
                                      </li>
                                      <li>
                                        Click <strong>Save</strong> at the top of this
                                        page, then send a test document email.
                                      </li>
                                    </ol>
                                  )}
                                </BlockStack>
                              </Box>
                            </Collapsible>
                          </Box>

                          <InlineStack gap="200" blockAlign="center">
                            <Button
                              size="slim"
                              pressed={smtpHelpProvider === "gmail"}
                              onClick={applyGmailSmtpPreset}
                            >
                              Use Gmail
                            </Button>
                            <Button
                              size="slim"
                              pressed={smtpHelpProvider === "webmail"}
                              onClick={applyWebmailSmtpPreset}
                            >
                              Use Webmail
                            </Button>
                            <Text as="span" tone="subdued">
                              {smtpHelpProvider === "gmail"
                                ? "Gmail needs an App Password, not your regular password."
                                : "Hostinger example: smtp.hostinger.com · port 465 · SSL"}
                            </Text>
                          </InlineStack>

                          <TextField
                            label="SMTP host"
                            value={smtpSettings.host}
                            placeholder={
                              smtpHelpProvider === "gmail"
                                ? "smtp.gmail.com"
                                : "smtp.hostinger.com"
                            }
                            onChange={(value) => updateSmtpField("host", value)}
                            autoComplete="off"
                          />

                          <InlineStack gap="400" blockAlign="end" wrap={false}>
                            <div className="settings-port-field">
                              <TextField
                                label="Port"
                                value={smtpSettings.port}
                                placeholder="587"
                                onChange={(value) => updateSmtpField("port", value)}
                                autoComplete="off"
                              />
                            </div>
                            <Checkbox
                              label="Use TLS"
                              checked={smtpSettings.encryption === "tls"}
                              onChange={(checked) => {
                                if (checked) {
                                  updateSmtpField("encryption", "tls");
                                  return;
                                }
                                updateSmtpField(
                                  "encryption",
                                  smtpSettings.port === "465" ? "ssl" : "none",
                                );
                              }}
                            />
                          </InlineStack>

                          <InlineStack gap="300" wrap={false}>
                            <div className="settings-flex-field">
                              <TextField
                                label="From email"
                                type="email"
                                value={smtpSettings.fromEmail}
                                placeholder="you@gmail.com"
                                onChange={(value) =>
                                  updateSmtpField("fromEmail", value)
                                }
                                autoComplete="email"
                              />
                            </div>
                            <div className="settings-flex-field">
                              <TextField
                                label="From name"
                                value={smtpSettings.fromName}
                                placeholder="Your Store"
                                onChange={(value) =>
                                  updateSmtpField("fromName", value)
                                }
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>

                          <InlineStack gap="300" wrap={false}>
                            <div className="settings-flex-field">
                              <TextField
                                label="Username"
                                value={smtpSettings.username}
                                placeholder="Same as from email"
                                onChange={(value) =>
                                  updateSmtpField("username", value)
                                }
                                autoComplete="off"
                              />
                            </div>
                            <div className="settings-flex-field">
                              <TextField
                                label="Password"
                                type="password"
                                value={smtpSettings.password}
                                placeholder={
                                  hasSmtpPassword
                                    ? "Leave blank to keep existing"
                                    : "App password"
                                }
                                onChange={(value) =>
                                  updateSmtpField("password", value)
                                }
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>

                          {smtpSettings.host ? (
                            <Banner tone="info" title="SMTP ready">
                              <p>
                                Document emails will send through this server when
                                you use Send Email. Turn PDF attach on in Email
                                templates.
                              </p>
                            </Banner>
                          ) : (
                            <Banner tone="warning" title="SMTP not configured">
                              <p>
                                Set up SMTP here before using Send Email. Without
                                SMTP, document emails cannot be sent from the app.
                              </p>
                            </Banner>
                          )}

                          {isSmtpDirty ? (
                            <Text as="p" tone="subdued">
                              Unsaved changes
                            </Text>
                          ) : null}
                        </BlockStack>
                      ) : isEmailTemplatesSection(activeSection) ? (
                        <BlockStack gap="400">
                          <Text as="p" tone="subdued">
                            {activeItem.description}
                          </Text>

                          <InlineStack gap="200">
                            <Button
                              variant="tertiary"
                              onClick={resetEmailTemplateToDefault}
                            >
                              Reset this
                            </Button>
                            <Button
                              variant="tertiary"
                              onClick={loadAllReadyEmailTemplates}
                            >
                              Load all ready
                            </Button>
                          </InlineStack>

                          <InlineStack gap="300" blockAlign="end" wrap={false}>
                            <div className="settings-flex-field">
                              <TextField
                                label="Subject"
                                value={
                                  emailTemplates.templates[emailTemplateKind].subject
                                }
                                onChange={(value) =>
                                  updateEmailTemplateField("subject", value)
                                }
                                autoComplete="off"
                              />
                            </div>
                            <Checkbox
                              label="Attach PDF"
                              checked={
                                emailTemplates.templates[emailTemplateKind].attachPdf
                              }
                              onChange={(checked) =>
                                updateEmailTemplateField("attachPdf", checked)
                              }
                            />
                          </InlineStack>

                          <Suspense
                            fallback={
                              <Text as="p" tone="subdued">
                                Loading editor…
                              </Text>
                            }
                          >
                            <EmailBodyEditor
                              key={emailTemplateKind}
                              ref={emailBodyEditorRef}
                              label="Body"
                              value={emailTemplates.templates[emailTemplateKind].body}
                              onChange={(html) =>
                                updateEmailTemplateField("body", html)
                              }
                            />
                          </Suspense>

                          <div className="settings-email-placeholders">
                            {EMAIL_TEMPLATE_PLACEHOLDERS.map((token) => (
                              <button
                                key={token}
                                type="button"
                                className="settings-email-placeholders__chip"
                                onClick={() =>
                                  emailBodyEditorRef.current?.insertText(token)
                                }
                              >
                                {token}
                              </button>
                            ))}
                          </div>

                          <div className="settings-email-design-row">
                            <InlineStack gap="300" wrap={false}>
                              <div className="settings-flex-field">
                                <AppearanceColorField
                                  label="Header"
                                  value={emailTemplates.design.headerColor}
                                  fallback="#111827"
                                  onChange={(value) =>
                                    updateEmailDesign("headerColor", value)
                                  }
                                />
                              </div>
                              <div className="settings-flex-field">
                                <AppearanceColorField
                                  label="Accent"
                                  value={emailTemplates.design.accentColor}
                                  fallback="#0f766e"
                                  onChange={(value) =>
                                    updateEmailDesign("accentColor", value)
                                  }
                                />
                              </div>
                            </InlineStack>
                            <InlineStack gap="300" blockAlign="end" wrap={false}>
                              <div className="settings-flex-field">
                                <TextField
                                  label="Footer"
                                  value={emailTemplates.design.footerText}
                                  onChange={(value) =>
                                    updateEmailDesign("footerText", value)
                                  }
                                  autoComplete="off"
                                />
                              </div>
                              <Checkbox
                                label="Store header"
                                checked={emailTemplates.design.includeLogo}
                                onChange={(checked) =>
                                  updateEmailDesign("includeLogo", checked)
                                }
                              />
                            </InlineStack>
                          </div>

                          {isEmailTemplatesDirty ? (
                            <Text as="p" tone="subdued">
                              Unsaved changes
                            </Text>
                          ) : null}
                        </BlockStack>
                      ) : null}
                    </BlockStack>
                  </Card>
                  )}
                  </div>
                </Layout.Section>

                {isEmailTemplatesSection(activeSection) ? (
                  <Layout.Section variant="oneThird">
                    <div
                      className="settings-email-preview-column"
                      aria-label="Email preview"
                    >
                      <Card padding="0">
                        <div className="settings-email-preview-panel">
                          <div className="settings-email-preview-panel__bar">
                            <Text as="span" fontWeight="semibold">
                              Email preview
                            </Text>
                            {emailPreview.attachPdf ? (
                              <Badge tone="info">PDF attached</Badge>
                            ) : (
                              <Badge>No PDF</Badge>
                            )}
                          </div>
                          <div className="settings-email-preview-panel__subject">
                            <span className="settings-email-preview-panel__subject-label">
                              Subject
                            </span>
                            <span>{emailPreview.subject}</span>
                          </div>
                          <div className="settings-email-preview-card-wrap">
                            <div
                              className="settings-email-preview-card"
                              style={
                                {
                                  ["--email-accent" as string]:
                                    emailPreview.design.accentColor,
                                } as CSSProperties
                              }
                            >
                              {emailPreview.design.includeLogo ? (
                                <div
                                  className="settings-email-preview-card__header"
                                  style={{
                                    background: emailPreview.design.headerColor,
                                  }}
                                >
                                  <div className="settings-email-preview-card__store">
                                    {emailPreview.storeName}
                                  </div>
                                  <div
                                    className="settings-email-preview-card__accent-line"
                                    style={{
                                      background: emailPreview.design.accentColor,
                                    }}
                                  />
                                </div>
                              ) : (
                                <div
                                  className="settings-email-preview-card__accent-bar"
                                  style={{
                                    background: emailPreview.design.accentColor,
                                  }}
                                />
                              )}
                              <div
                                className="settings-email-preview-card__body"
                                dangerouslySetInnerHTML={{
                                  __html: bodyContentToHtml(emailPreview.bodyText),
                                }}
                              />
                              <div className="settings-email-preview-card__meta">
                                <span
                                  className="settings-email-preview-card__pill"
                                  style={{
                                    color: emailPreview.design.accentColor,
                                    background: `${emailPreview.design.accentColor}14`,
                                  }}
                                >
                                  {emailPreview.documentType}
                                </span>
                                <span className="settings-email-preview-card__doc-no">
                                  {emailPreview.documentNumber}
                                </span>
                              </div>
                              <div className="settings-email-preview-card__amount">
                                <span>Amount</span>
                                <strong>{emailPreview.amountLabel}</strong>
                              </div>
                              <div className="settings-email-preview-card__footer">
                                {emailPreview.design.footerText}
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </div>
                  </Layout.Section>
                ) : (
                  <Layout.Section variant="oneThird">
                    <RecommendedAppsSidebar />
                  </Layout.Section>
                )}
              </Layout>
            </div>
          </BlockStack>
        </Page>
      </AppProvider>
    </>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:settings-recover-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
