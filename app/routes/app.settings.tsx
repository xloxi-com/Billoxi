import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
  Thumbnail,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DragHandleIcon,
  EditIcon,
  EmailIcon,
  NoteIcon,
  OrderIcon,
  StoreIcon,
} from "@shopify/polaris-icons";

import type { EmailBodyEditorHandle } from "../components/email-body-editor";

const EmailBodyEditor = lazy(() =>
  import("../components/email-body-editor").then((mod) => ({
    default: mod.EmailBodyEditor,
  })),
);
import { requireAdminAuth } from "../shopify-context.server";
import {
  formatNumberSeriesNextPreview,
  normalizeNumberSeries,
  NUMBER_SERIES_MODULES,
  numberingFromSeries,
  parseNumberSeriesDigits,
  resolveNumberSeriesNextSequence,
  widenStartingNumberPad,
  type NumberSeriesEntry,
  type NumberSeriesMap,
  type NumberSeriesModuleId,
} from "../number-series";
import {
  getInvoiceNumberDigitWidth,
  getLastInvoiceAllocatedSequence,
} from "../order-invoice-status.server";
import {
  GMAIL_SMTP_PRESET,
  WEBMAIL_SMTP_PRESET,
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
  type StoreCustomField,
  type StoreDetails,
} from "../store-details";
import {
  loadEmailTemplatesForShop,
  loadNumberSeriesForShop,
  loadSelectedTemplateForShop,
  loadSmtpSettingsForShop,
  loadStoreDetailsForShop,
  resetStoreDetailsFromShopify,
  saveEmailTemplatesForShop,
  saveNumberSeriesForShop,
  saveSmtpSettingsForShop,
  saveStoreDetailsForShop,
} from "../shop-settings.server";
import {
  getLastAllocatedSequence,
  syncNumberCounter,
  validateStartingNumber,
} from "../sales-order-number.server";
import { resolveSalesOrderTemplateId } from "../sales-order-ids";
import offrefyLogo from "../assets/recommended/offrefy.png";
import approvefyLogo from "../assets/recommended/approvefy.png";
import "../settings.css";

const RECOMMENDED_APPS = [
  {
    id: "offrefy",
    name: "Offrefy",
    tagline: "Ultra Quantity Breaks",
    description:
      "Raise order value with quantity breaks and volume discounts that apply at checkout.",
    href: "https://apps.shopify.com/offrefy",
    badge: "Free plan",
    logo: offrefyLogo,
  },
  {
    id: "approvefy",
    name: "Approvefy",
    tagline: "B2B legacy Signup",
    description:
      "B2B registration forms with manual approval, company accounts, and legacy customer support.",
    href: "https://apps.shopify.com/approvefy",
    badge: "From $4.99/mo",
    logo: approvefyLogo,
  },
] as const;

type SettingsSection =
  | "store-details"
  | "number-series"
  | "smtp"
  | "email-sales-order"
  | "email-invoice"
  | "email-credit-note"
  | "email-packing-slip";

type SettingsMenuItem = {
  id: SettingsSection;
  label: string;
  description: string;
  icon: "store" | "order" | "email" | "note";
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
};

function isEmailTemplatesSection(section: SettingsSection): boolean {
  return (
    section === "email-sales-order" ||
    section === "email-invoice" ||
    section === "email-credit-note" ||
    section === "email-packing-slip"
  );
}

function parseSettingsSection(value: string | null): SettingsSection {
  if (
    value === "number-series" ||
    value === "smtp" ||
    value === "store-details" ||
    value === "email-sales-order" ||
    value === "email-invoice" ||
    value === "email-credit-note" ||
    value === "email-packing-slip"
  ) {
    return value;
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
  ] = await Promise.all([
    loadSelectedTemplateForShop(session.shop, "sales-order"),
    loadStoreDetailsForShop(session.shop, admin),
    loadSmtpSettingsForShop(session.shop),
    loadEmailTemplatesForShop(session.shop),
    loadNumberSeriesForShop(session.shop),
  ]);
  const selectedSalesOrderTemplateId = resolveSalesOrderTemplateId(
    selectedSalesOrderTemplateIdRaw,
  );
  const [lastAllocatedSequence, lastInvoiceSequence, invoiceDigitWidth] =
    await Promise.all([
      getLastAllocatedSequence(session.shop),
      getLastInvoiceAllocatedSequence(session.shop),
      getInvoiceNumberDigitWidth(session.shop),
    ]);
  const lastAllocatedByModule: Record<NumberSeriesModuleId, number | null> = {
    "sales-order": lastAllocatedSequence,
    invoice: lastInvoiceSequence,
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
    return { saved: true, section: "store-details" as const, storeDetails };
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
    );
    if (numberingError) {
      return Response.json(
        { saved: false, error: numberingError },
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
    const [lastAllocatedSequence, lastInvoiceSequence, invoiceDigitWidth] =
      await Promise.all([
        getLastAllocatedSequence(session.shop),
        getLastInvoiceAllocatedSequence(session.shop),
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

  const storeDetails = normalizeStoreDetails(parsed);
  if (!storeDetails.name) {
    return Response.json(
      { saved: false, error: "Store name is required." },
      { status: 400 },
    );
  }

  const saved = await saveStoreDetailsForShop(session.shop, storeDetails);
  return { saved: true, section: "store-details" as const, storeDetails: saved };
}

export default function SettingsPage() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const initialSection = parseSettingsSection(requestedSection);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>(initialSection);
  const [storeDetails, setStoreDetails] = useState<StoreDetails>(
    data.storeDetails,
  );
  const [logoError, setLogoError] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings>(
    data.smtpSettings,
  );
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
        : emailTemplateKind === "credit-note"
          ? "CN-0003"
          : emailTemplateKind === "packing-slip"
            ? "PS-0002"
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
    setLogoError("");
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") return;
      setStoreDetails((current) => ({
        ...current,
        logoDataUrl: reader.result as string,
        logoFileName: file.name,
      }));
      setIsStoreDirty(true);
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

    const last = lastAllocatedByModule[moduleId] ?? null;
    const startAt = Number.parseInt(entry.startingNumber, 10);
    const start = Number.isFinite(startAt) && startAt >= 0 ? startAt : 1;
    const minNext = last == null ? start : last + 1;
    const nextSequence = Math.max(minNext, parsed.sequence);
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
    setPreviewDrafts((current) => ({
      ...current,
      [moduleId]: previewForModule(moduleId),
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
  };

  const previewForModule = (moduleId: NumberSeriesModuleId) => {
    const entry = numberSeries[moduleId];
    const last = lastAllocatedByModule[moduleId] ?? null;
    if (moduleId === "invoice") {
      const padded = {
        ...entry,
        startingNumber: widenStartingNumberPad(
          entry.startingNumber,
          Math.max(invoiceDigitWidth, entry.startingNumber.length),
        ),
      };
      return formatNumberSeriesNextPreview(padded, last);
    }
    return formatNumberSeriesNextPreview(entry, last);
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
            {fetcher.data && "error" in fetcher.data && fetcher.data.error ? (
              <Banner tone="critical" title="Could not save">
                <p>{String(fetcher.data.error)}</p>
              </Banner>
            ) : null}

            <div
              className={`settings-page${
                isEmailTemplatesSection(activeSection)
                  ? " settings-page--with-preview"
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
                                onClick={() =>
                                  switchSection(
                                    groupActive
                                      ? activeSection
                                      : item.children[0].id,
                                  )
                                }
                              >
                                <Icon
                                  source={SETTINGS_MENU_ICONS[item.icon]}
                                  tone={groupActive ? "base" : "subdued"}
                                />
                                <Text as="span" fontWeight="semibold">
                                  {item.label}
                                </Text>
                              </button>
                              {item.children.map((child) => {
                                const isActive = child.id === activeSection;
                                return (
                                  <button
                                    key={child.id}
                                    type="button"
                                    className={`settings-nav-item settings-nav-item--sub${
                                      isActive ? " settings-nav-item--active" : ""
                                    }`}
                                    onClick={() => switchSection(child.id)}
                                  >
                                    <Text
                                      as="span"
                                      fontWeight={isActive ? "semibold" : "regular"}
                                    >
                                      {child.label}
                                    </Text>
                                  </button>
                                );
                              })}
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

                          <BlockStack gap="300">
                            <Text as="h3" variant="headingSm">
                              Store logo
                            </Text>
                            <Text as="p" tone="subdued">
                              Used on every sales order, invoice, credit note,
                              and packing slip template. Set size per template
                              in Templates → Edit → Transaction details.
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
                          >
                            <button
                              type="button"
                              className="settings-smtp-help__toggle"
                              aria-expanded={smtpHelpOpen}
                              aria-controls="smtp-help-collapsible"
                              onClick={() => setSmtpHelpOpen((open) => !open)}
                            >
                              <InlineStack align="space-between" blockAlign="center">
                                <Text as="span" fontWeight="semibold">
                                  How to set up SMTP
                                </Text>
                                <Icon
                                  source={smtpHelpOpen ? ChevronUpIcon : ChevronDownIcon}
                                />
                              </InlineStack>
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
                                Without a host, Send Email opens a mailto draft
                                instead of sending from the app.
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
                                <TextField
                                  label="Header"
                                  value={emailTemplates.design.headerColor}
                                  onChange={(value) =>
                                    updateEmailDesign(
                                      "headerColor",
                                      value || "#1a1a1a",
                                    )
                                  }
                                  autoComplete="off"
                                />
                              </div>
                              <div className="settings-flex-field">
                                <TextField
                                  label="Accent"
                                  value={emailTemplates.design.accentColor}
                                  onChange={(value) =>
                                    updateEmailDesign(
                                      "accentColor",
                                      value || "#2c6ecb",
                                    )
                                  }
                                  autoComplete="off"
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
                    <div
                      className="settings-recommend-column"
                      aria-label="Recommended apps"
                    >
                      <BlockStack gap="400">
                        <Text as="h2" variant="headingSm" tone="subdued">
                          More from XLOXI
                        </Text>
                        {RECOMMENDED_APPS.map((app) => (
                          <Card key={app.id}>
                            <BlockStack gap="300">
                              <InlineStack
                                align="space-between"
                                blockAlign="start"
                                gap="300"
                                wrap={false}
                              >
                                <InlineStack
                                  gap="300"
                                  blockAlign="center"
                                  wrap={false}
                                >
                                  <img
                                    src={app.logo}
                                    alt={`${app.name} logo`}
                                    className="settings-recommend-card__logo"
                                    width={48}
                                    height={48}
                                  />
                                  <BlockStack gap="100">
                                    <Text as="h3" variant="headingSm">
                                      {app.name}
                                    </Text>
                                    <Text as="p" tone="subdued" variant="bodySm">
                                      {app.tagline}
                                    </Text>
                                  </BlockStack>
                                </InlineStack>
                                <Badge>{app.badge}</Badge>
                              </InlineStack>
                              <Text as="p" variant="bodySm">
                                {app.description}
                              </Text>
                              <Button
                                url={app.href}
                                external
                                variant="primary"
                                fullWidth
                              >
                                View on App Store
                              </Button>
                            </BlockStack>
                          </Card>
                        ))}
                      </BlockStack>
                    </div>
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
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
