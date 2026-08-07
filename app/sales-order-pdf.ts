import {
  formatOrderDate,
  formatStoreAddressLines,
  buildTaxSummaryFromLineItems,
  currencySymbol,
  defaultTemplateAppearance,
  formatSalesOrderDocumentNumber,
  formatTaxLineLabel,
  formatQuantityDisplay,
  computeTotalItemQuantity,
  formatAmountDisplay,
  hasNonZeroAmount,
  shouldShowDocumentPaidAmount,
  shouldShowDocumentBalanceDue,
  shouldShowDocumentRefundedAmount,
  lineItemImageSizeMm,
  normalizePaymentStatusStyle,
  paperMarginMm,
  resolveDisplayedUnitPrice,
  resolveTaxSummaryLabel,
  salesOrderLogoPosition,
  taxSummaryDisplayRows,
  taxSummaryTotals,
  reconcileTaxSummaryToOrderTotal,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
} from "./sales-order-document";
import type { StoreDetails } from "./store-details";

type JsPdfCtor = typeof import("jspdf").jsPDF;
type JsPdf = InstanceType<JsPdfCtor>;

let jsPdfCtorPromise: Promise<JsPdfCtor> | null = null;

/** Lazy-load jsPDF so list/detail routes don't pay for it until PDF actions run. */
async function loadJsPdf(): Promise<JsPdfCtor> {
  if (!jsPdfCtorPromise) {
    jsPdfCtorPromise = import("jspdf").then((mod) => mod.jsPDF);
  }
  return jsPdfCtorPromise;
}

type PdfArgs = {
  order: SalesOrderDocumentData;
  settings: TemplateEditorSettings;
  storeDetails: StoreDetails;
  templateId: string;
};

const PDF_FONT = "NotoSans";
/** Match `.live-document { line-height: 1.45 }` */
const LINE_HEIGHT = 1.45;
const PT_TO_MM = 0.352778;

/**
 * Template appearance sizes are authored as CSS px (preview).
 * jsPDF `setFontSize` expects pt — convert so vector PDF matches on-screen size.
 */
function appearancePxToPt(px: number) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return 9;
  return Math.max(5, n * (72 / 96));
}

let fontLoadPromise: Promise<{ regular: string; bold: string }> | null = null;

function lineStep(fontPt: number, factor = LINE_HEIGHT) {
  return fontPt * factor * PT_TO_MM;
}

function emMm(fontPt: number, em: number) {
  return fontPt * em * PT_TO_MM;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function loadPdfFonts() {
  if (!fontLoadPromise) {
    fontLoadPromise = Promise.all([
      fetch("/fonts/NotoSans-Regular.ttf").then((response) => {
        if (!response.ok) throw new Error("Failed to load NotoSans Regular");
        return response.arrayBuffer();
      }),
      fetch("/fonts/NotoSans-Bold.ttf").then((response) => {
        if (!response.ok) throw new Error("Failed to load NotoSans Bold");
        return response.arrayBuffer();
      }),
    ]).then(([regular, bold]) => ({
      regular: arrayBufferToBase64(regular),
      bold: arrayBufferToBase64(bold),
    }));
  }
  return fontLoadPromise;
}

/**
 * Load Noto Sans as a CSS font so DOM measurement uses the same metrics
 * as jsPDF vector text (preview layout → PDF positions stay aligned).
 */
let measureFontReady: Promise<void> | null = null;

async function ensureDomMeasureFont(): Promise<void> {
  if (typeof document === "undefined") return;
  if (!measureFontReady) {
    measureFontReady = (async () => {
      const styleId = "billoxi-pdf-measure-font";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
@font-face {
  font-family: "${PDF_FONT}";
  src: url("/fonts/NotoSans-Regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "${PDF_FONT}";
  src: url("/fonts/NotoSans-Bold.ttf") format("truetype");
  font-weight: 600 700;
  font-style: normal;
  font-display: block;
}`;
        document.head.appendChild(style);
      }
      if (document.fonts?.load) {
        try {
          await Promise.all([
            document.fonts.load(`400 12px ${PDF_FONT}`),
            document.fonts.load(`700 12px ${PDF_FONT}`),
          ]);
        } catch {
          // Fall through — browser may still resolve after fonts.ready
        }
      }
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // ignore
        }
      }
    })();
  }
  await measureFontReady;
}

function registerPdfFonts(
  pdf: JsPdf,
  fonts: { regular: string; bold: string },
) {
  pdf.addFileToVFS("NotoSans-Regular.ttf", fonts.regular);
  pdf.addFont("NotoSans-Regular.ttf", PDF_FONT, "normal");
  pdf.addFileToVFS("NotoSans-Bold.ttf", fonts.bold);
  pdf.addFont("NotoSans-Bold.ttf", PDF_FONT, "bold");
  pdf.setFont(PDF_FONT, "normal");
}

function hexToRgb(color: string): [number, number, number] {
  const value = color.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(value);
  if (short) {
    const [r, g, b] = short[1].split("").map((ch) => parseInt(ch + ch, 16));
    return [r, g, b];
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (full) {
    return [
      parseInt(full[1].slice(0, 2), 16),
      parseInt(full[1].slice(2, 4), 16),
      parseInt(full[1].slice(4, 6), 16),
    ];
  }
  return [255, 255, 255];
}

function currencyPrefix(code: string) {
  if (code === "EUR") return "€";
  if (code === "USD") return "$";
  if (code === "GBP") return "£";
  if (code === "INR") return "₹";
  return `${code} `;
}

function asText(value: unknown) {
  if (value == null) return "";
  return String(value);
}

function loadImageSize(dataUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (!width || !height) {
        reject(new Error("Logo has invalid dimensions"));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => reject(new Error("Failed to load logo image"));
    image.src = dataUrl;
  });
}

async function loadRemoteImageDataUrl(url: string): Promise<{
  dataUrl: string;
  format: "PNG" | "JPEG";
} | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) {
    const format = detectImageFormat(trimmed);
    return { dataUrl: trimmed, format };
  }
  try {
    const response = await fetch(trimmed, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read image"));
      reader.readAsDataURL(blob);
    });
    if (!dataUrl.startsWith("data:image/")) return null;
    const format =
      blob.type.includes("png") || dataUrl.includes("image/png")
        ? "PNG"
        : "JPEG";
    return { dataUrl, format };
  } catch {
    return null;
  }
}

function detectImageFormat(src: string): "PNG" | "JPEG" {
  const value = src.toLowerCase();
  if (
    value.includes("image/png") ||
    value.endsWith(".png") ||
    value.includes(".png?")
  ) {
    return "PNG";
  }
  return "JPEG";
}

/**
 * Shrink CDN/full-res bitmaps before embedding.
 * Product thumbs are ~28–56 CSS px; 2.5× is enough for sharp print without
 * shipping multi-megapixel Shopify images into a 4MB+ PDF.
 */
function pdfEmbedTargetSize(
  naturalW: number,
  naturalH: number,
  displayW: number,
  displayH: number,
): { width: number; height: number } {
  const displayEdge = Math.max(displayW, displayH, 1);
  const maxEdge = Math.min(480, Math.max(96, Math.round(displayEdge * 2.5)));
  const naturalEdge = Math.max(naturalW, naturalH, 1);
  if (naturalEdge <= maxEdge) {
    return {
      width: Math.max(1, Math.round(naturalW)),
      height: Math.max(1, Math.round(naturalH)),
    };
  }
  const scale = maxEdge / naturalEdge;
  return {
    width: Math.max(1, Math.round(naturalW * scale)),
    height: Math.max(1, Math.round(naturalH * scale)),
  };
}

function pdfEmbedFormat(
  src: string,
  displayW: number,
  displayH: number,
): "PNG" | "JPEG" {
  const preferPng =
    detectImageFormat(src) === "PNG" ||
    src.includes("image/webp") ||
    src.includes("image/svg");
  // Line-item thumbs: always JPEG (much smaller). Keep PNG for larger logos.
  const isLikelyThumb = Math.max(displayW, displayH, 1) <= 80;
  if (isLikelyThumb) return "JPEG";
  return preferPng ? "PNG" : "JPEG";
}

const PDF_JPEG_QUALITY = 0.78;

/**
 * Re-encode an <img> to a jsPDF-safe PNG/JPEG data URL.
 * Handles data: URLs, same-origin URLs, and avoids WebP/unsupported formats.
 */
async function rasterizeImageForPdf(
  img: HTMLImageElement,
): Promise<{ dataUrl: string; format: "PNG" | "JPEG" } | null> {
  const src = (img.currentSrc || img.src || "").trim();
  if (!src) return null;

  const rect = img.getBoundingClientRect();
  const displayW = rect.width || img.width || 40;
  const displayH = rect.height || img.height || 40;

  // Ensure the bitmap is decoded.
  if (!img.complete || img.naturalWidth <= 0) {
    await new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }
  if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    // Fallback: fetch + decode into a new Image.
    const loaded = await loadRemoteImageDataUrl(src);
    if (!loaded) return null;
    try {
      const dims = await loadImageSize(loaded.dataUrl);
      const target = pdfEmbedTargetSize(
        dims.width,
        dims.height,
        displayW,
        displayH,
      );
      return rasterizeDataUrlForPdf(
        loaded.dataUrl,
        target.width,
        target.height,
        pdfEmbedFormat(src, displayW, displayH),
      );
    } catch {
      return loaded;
    }
  }

  const format = pdfEmbedFormat(src, displayW, displayH);
  const target = pdfEmbedTargetSize(
    img.naturalWidth,
    img.naturalHeight,
    displayW,
    displayH,
  );

  try {
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return loadRemoteImageDataUrl(src);

    if (format === "JPEG") {
      // JPEG has no alpha — fill white so dark logos on transparent don't vanish.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const mime = format === "PNG" ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(
      mime,
      format === "JPEG" ? PDF_JPEG_QUALITY : undefined,
    );
    if (!dataUrl.startsWith("data:image/")) return loadRemoteImageDataUrl(src);
    return { dataUrl, format };
  } catch {
    return loadRemoteImageDataUrl(src);
  }
}

async function rasterizeDataUrlForPdf(
  dataUrl: string,
  width: number,
  height: number,
  formatOverride?: "PNG" | "JPEG",
): Promise<{ dataUrl: string; format: "PNG" | "JPEG" } | null> {
  const format = formatOverride ?? detectImageFormat(dataUrl);
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width || image.naturalWidth));
  canvas.height = Math.max(1, Math.round(height || image.naturalHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) return { dataUrl, format };
  if (format === "JPEG") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const mime = format === "PNG" ? "image/png" : "image/jpeg";
  return {
    dataUrl: canvas.toDataURL(
      mime,
      format === "JPEG" ? PDF_JPEG_QUALITY : undefined,
    ),
    format,
  };
}

/** Attach embeddable data URLs onto every <img> before DOM→PDF measure. */
async function prepareCloneImagesForPdf(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (img) => {
      const embedded = await rasterizeImageForPdf(img);
      if (!embedded) return;
      img.setAttribute("data-pdf-embed", embedded.dataUrl);
      img.setAttribute("data-pdf-format", embedded.format);
      // Keep natural size attrs for collectors that check naturalWidth.
      if (img.naturalWidth <= 0) {
        try {
          const dims = await loadImageSize(embedded.dataUrl);
          img.width = dims.width;
          img.height = dims.height;
        } catch {
          // ignore
        }
      }
    }),
  );
}

/** Fit logo into max box while keeping original aspect ratio (no stretch). */
function fitLogoSize(
  naturalWidth: number,
  naturalHeight: number,
  logoSize: number,
) {
  const maxWidthMm = Math.min(Math.max(logoSize * 0.55, 18), 55);
  const maxHeightMm = Math.min(Math.max(logoSize * 0.28, 10), 28);
  const ratio = naturalWidth / naturalHeight;

  let width = maxWidthMm;
  let height = width / ratio;

  if (height > maxHeightMm) {
    height = maxHeightMm;
    width = height * ratio;
  }

  return { width, height };
}

function partyLines(
  fields: TemplateEditorSettings["billingDetails"],
  party: SalesOrderDocumentData["billing"],
) {
  const lines: Array<{
    text: string;
    bold?: boolean;
    sizeKind?: "company" | "name" | "body";
  }> = [];
  for (const field of fields) {
    if (!field.enabled) continue;
    if (field.key === "company" && party.company) {
      lines.push({ text: party.company, bold: true, sizeKind: "company" });
    } else if (field.key === "name" && party.name) {
      lines.push({ text: party.name, bold: true, sizeKind: "name" });
    } else if (field.key === "address") {
      for (const line of party.address)
        lines.push({ text: line, sizeKind: "body" });
    } else if (field.key === "phone" && party.phone) {
      lines.push({
        text: `${field.label.trim() || "Phone"}: ${party.phone}`,
        sizeKind: "body",
      });
    } else if (field.key === "email" && party.email) {
      lines.push({
        text: `${field.label.trim() || "Email"}: ${party.email}`,
        sizeKind: "body",
      });
    }
  }
  return lines;
}

function cellValue(
  columnKey: string,
  item: SalesOrderDocumentData["lineItems"][number],
  index: number,
  settings?: TemplateEditorSettings,
) {
  switch (columnKey) {
    case "number":
      return String(index + 1);
    case "item":
      return asText(item.title);
    case "quantity":
      return formatQuantityDisplay(item.quantity);
    case "ean":
    case "sku":
      return asText(item.sku) || "-";
    case "rate":
      return formatAmountDisplay(item.rate);
    case "discount":
      return formatAmountDisplay(item.discount || 0);
    case "discountPercentage":
      return asText(item.discountPercentage) || "0,00%";
    case "taxPercentage":
      return asText(item.taxPercentage) || "0,00%";
    case "taxAmount":
      return formatAmountDisplay(item.taxAmount || 0);
    case "amount":
      return formatAmountDisplay(item.amount || 0);
    default:
      return "-";
  }
}

function itemColumnLines(item: SalesOrderDocumentData["lineItems"][number]) {
  const lines = [asText(item.title) || "-"];
  if (item.variantTitle) lines.push(asText(item.variantTitle));
  return lines;
}

export function salesOrderPdfFileName(
  orderName: string,
  documentKind: "sales-order" | "invoice" | "credit-note" = "sales-order",
) {
  const safeName = orderName.replace(/[^\w.-]+/g, "_");
  const suffix =
    documentKind === "invoice"
      ? "invoice"
      : documentKind === "credit-note"
        ? "credit-note"
        : "sales-order";
  return `${safeName}-${suffix}.pdf`;
}

/** Prime fonts from base64 (e.g. server disk load) so Node can build PDFs. */
export function primePdfFontsFromBase64(fonts: {
  regular: string;
  bold: string;
}) {
  fontLoadPromise = Promise.resolve(fonts);
}

/**
 * Builds a true vector PDF (text/lines/rects), so zoom stays sharp like SVG.
 * Embeds Noto Sans so glyphs never fall back to empty boxes.
 */
async function buildSalesOrderVectorPdf({
  order,
  settings,
  storeDetails,
  templateId,
}: PdfArgs) {
  const fonts = await loadPdfFonts();

  const orientation =
    settings.orientation === "landscape" ? "landscape" : "portrait";
  const format =
    settings.paperSize === "Letter"
      ? "letter"
      : settings.paperSize === "A5"
        ? "a5"
        : "a4";

  const JsPDF = await loadJsPdf();
  const pdf = new JsPDF({
    orientation,
    unit: "mm",
    format,
    compress: true,
  });
  registerPdfFonts(pdf, fonts);

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = paperMarginMm(settings.margins);
  const contentWidth = pageWidth - margin.left - margin.right;
  let y = margin.top;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageHeight - margin.bottom) return;
    pdf.addPage();
    registerPdfFonts(pdf, fonts);
    y = margin.top;
  };

  const setFont = (style: "normal" | "bold" = "normal", size = 9) => {
    pdf.setFont(PDF_FONT, style);
    pdf.setFontSize(size);
  };

  const appearance = settings.appearance ?? defaultTemplateAppearance;
  const sizeBody = appearancePxToPt(appearance.bodyFontSize);
  const sizeSmall = Math.max(5.5, sizeBody - 0.75);
  const sizeOrg = appearancePxToPt(appearance.organizationFontSize);
  const sizeOrgDetails = appearancePxToPt(
    appearance.organizationDetailsFontSize ?? appearance.bodyFontSize,
  );
  const sizeTitle = appearancePxToPt(appearance.titleFontSize);
  const sizeOrderNo = appearancePxToPt(appearance.orderNumberFontSize);
  const sizeMetadata = appearancePxToPt(
    appearance.metadataFontSize ?? appearance.bodyFontSize,
  );
  const sizeCompany = appearancePxToPt(appearance.companyFontSize);
  const sizeCustomerName = appearancePxToPt(
    appearance.customerNameFontSize ?? appearance.bodyFontSize,
  );
  const sizeCustomerDetails = appearancePxToPt(
    appearance.customerDetailsFontSize ?? appearance.bodyFontSize,
  );
  const sizeAddressLabel = appearancePxToPt(
    appearance.addressLabelFontSize ??
      Math.max(7, appearance.bodyFontSize - 1),
  );
  const sizeTableHeader = appearancePxToPt(
    appearance.tableHeaderFontSize ??
      Math.max(7, appearance.bodyFontSize - 1),
  );
  const sizeTable = appearancePxToPt(
    appearance.tableBodyFontSize ?? Math.max(7, appearance.bodyFontSize - 1),
  );
  const sizeTotals = appearancePxToPt(
    appearance.totalsFontSize ?? appearance.bodyFontSize,
  );
  // `.live-document__grand-total { font-size: 1.1em }`
  const sizeTotal = sizeTotals * 1.1;
  const sizePaymentStatusLabel = appearancePxToPt(
    appearance.paymentStatusLabelFontSize ??
      appearance.totalsFontSize ??
      appearance.bodyFontSize,
  );
  const sizePaymentStatusValue = appearancePxToPt(
    appearance.paymentStatusValueFontSize ??
      appearance.totalsFontSize ??
      appearance.bodyFontSize,
  );
  const sizeTaxSummaryTitle = appearancePxToPt(
    appearance.taxSummaryTitleFontSize ??
      appearance.tableHeaderFontSize ??
      appearance.bodyFontSize,
  );
  const sizeTaxSummaryHeader = appearancePxToPt(
    appearance.taxSummaryHeaderFontSize ??
      appearance.tableHeaderFontSize ??
      appearance.bodyFontSize,
  );
  const sizeTaxSummaryBody = appearancePxToPt(
    appearance.taxSummaryBodyFontSize ??
      appearance.tableBodyFontSize ??
      appearance.bodyFontSize,
  );
  const sizeNotesLabel = appearancePxToPt(
    appearance.notesLabelFontSize ?? appearance.bodyFontSize,
  );
  const sizeNotesBody = appearancePxToPt(
    appearance.notesBodyFontSize ?? appearance.bodyFontSize,
  );
  const sizeTermsLabel = appearancePxToPt(
    appearance.termsLabelFontSize ?? appearance.bodyFontSize,
  );
  const sizeTermsBody = appearancePxToPt(
    appearance.termsBodyFontSize ?? appearance.bodyFontSize,
  );
  const notesLabelRgb = hexToRgb(
    appearance.notesLabelColor ?? appearance.textColor,
  );
  const notesBodyRgb = hexToRgb(
    appearance.notesBodyColor ?? appearance.textColor,
  );
  const termsLabelRgb = hexToRgb(
    appearance.termsLabelColor ?? appearance.textColor,
  );
  const termsBodyRgb = hexToRgb(
    appearance.termsBodyColor ?? appearance.textColor,
  );
  const textRgb = hexToRgb(appearance.textColor);
  const headingRgb = hexToRgb(appearance.headingColor);
  const mutedRgb = hexToRgb(appearance.mutedColor);
  const unitPriceRgb = hexToRgb(
    appearance.unitPriceColor ?? appearance.textColor,
  );
  const comparePriceRgb = hexToRgb(
    appearance.comparePriceColor ?? appearance.mutedColor,
  );
  const organizationRgb = hexToRgb(appearance.organizationColor);
  const paymentStatusLabelRgb = hexToRgb(
    appearance.paymentStatusLabelColor ?? appearance.organizationColor,
  );
  const paymentStatusValueRgb = hexToRgb(
    appearance.paymentStatusValueColor ?? appearance.textColor,
  );
  const paymentStatusBorderRgb = hexToRgb(
    appearance.paymentStatusBorderColor ?? appearance.tableBorderColor,
  );
  const companyRgb = hexToRgb(appearance.companyColor);
  const customerNameRgb = hexToRgb(
    appearance.customerNameColor ?? appearance.textColor,
  );
  const customerDetailsRgb = hexToRgb(
    appearance.customerDetailsColor ?? appearance.textColor,
  );
  const orderNumberRgb = hexToRgb(appearance.orderNumberColor);
  const tableHeaderBg = hexToRgb(appearance.tableHeaderBackground);
  const tableHeaderText = hexToRgb(appearance.tableHeaderText);
  const tableBorderRgb = hexToRgb(appearance.tableBorderColor);
  const totalBg = hexToRgb(appearance.totalHighlightBackground);
  const taxSummaryTitleRgb = hexToRgb(
    appearance.taxSummaryTitleColor ?? appearance.headingColor,
  );
  const taxSummaryHeaderBg = hexToRgb(
    appearance.taxSummaryHeaderBackground ?? appearance.tableHeaderBackground,
  );
  const taxSummaryHeaderTextRgb = hexToRgb(
    appearance.taxSummaryHeaderText ?? appearance.tableHeaderText,
  );
  const taxSummaryTextRgb = hexToRgb(
    appearance.taxSummaryTextColor ?? appearance.textColor,
  );
  const taxSummaryBorderRgb = hexToRgb(
    appearance.taxSummaryBorderColor ?? appearance.tableBorderColor,
  );

  /** Draw one or more lines; returns baseline Y of last line. Advances like CSS line-height. */
  const drawLines = (
    text: string,
    x: number,
    startY: number,
    options?: {
      bold?: boolean;
      size?: number;
      align?: "left" | "center" | "right";
      maxWidth?: number;
      color?: [number, number, number];
      lineFactor?: number;
    },
  ) => {
    const size = options?.size ?? sizeBody;
    const factor = options?.lineFactor ?? LINE_HEIGHT;
    setFont(options?.bold ? "bold" : "normal", size);
    if (options?.color) pdf.setTextColor(...options.color);
    else pdf.setTextColor(...textRgb);

    const lines = pdf.splitTextToSize(
      asText(text),
      options?.maxWidth ?? contentWidth,
    ) as string[];
    let cursor = startY;
    for (const line of lines) {
      pdf.text(line, x, cursor, { align: options?.align ?? "left" });
      cursor += lineStep(size, factor);
    }
    // Return Y just after the last line box (next content can start here).
    return cursor;
  };

  const organizationName =
    settings.transactionLabels.organization ||
    storeDetails.name ||
    "Organization";
  const addressLines = formatStoreAddressLines(storeDetails);
  const orderDate = formatOrderDate(order.documentDate || order.createdAt);
  const documentNumber =
    order.documentNumber ||
    formatSalesOrderDocumentNumber(settings.numbering);
  const prefix = currencyPrefix(order.currencyCode);
  const columns = settings.columns.filter((column) => column.enabled);
  const totalColWidth =
    columns.reduce((sum, column) => sum + Math.max(column.width, 1), 0) || 1;

  // Background
  const [bgR, bgG, bgB] = hexToRgb(settings.backgroundColor || "#ffffff");
  pdf.setFillColor(bgR, bgG, bgB);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");

  // Header: organization + title (CSS gap 0.28em, margin-bottom 2.75em)
  const headerTop = y;
  let leftY = y + lineStep(sizeOrg) * 0.75;
  let rightY = y + lineStep(sizeTitle) * 0.75;
  const logoPosition = salesOrderLogoPosition(templateId, settings);
  const logoOnRight = logoPosition === "right";
  const orgX = logoOnRight ? margin.left + contentWidth : margin.left;
  const orgAlign = logoOnRight ? ("right" as const) : ("left" as const);
  const titleX = logoOnRight ? margin.left : margin.left + contentWidth;
  const titleAlign = logoOnRight ? ("left" as const) : ("right" as const);
  let orgY = leftY;
  let titleY = rightY;

  if (settings.header.showOrganization) {
    if (settings.header.showLogo && settings.logoDataUrl) {
      try {
        const logoFormat = settings.logoDataUrl.includes("image/png")
          ? "PNG"
          : "JPEG";
        const { width: naturalW, height: naturalH } = await loadImageSize(
          settings.logoDataUrl,
        );
        const { width: logoW, height: logoH } = fitLogoSize(
          naturalW,
          naturalH,
          settings.logoSize,
        );
        const logoX = logoOnRight ? orgX - logoW : orgX;
        pdf.addImage(
          settings.logoDataUrl,
          logoFormat,
          logoX,
          y,
          logoW,
          logoH,
        );
        orgY = y + logoH + emMm(sizeBody, 0.95);
      } catch {
        // Skip broken logos; continue with text.
      }
    }

    orgY = drawLines(organizationName, orgX, orgY, {
      bold: true,
      size: sizeOrg,
      color: organizationRgb,
      align: orgAlign,
      maxWidth: contentWidth * 0.48,
    });
    orgY += emMm(sizeBody, 0.08);
    for (const line of addressLines) {
      orgY = drawLines(line, orgX, orgY, {
        size: sizeOrgDetails,
        lineFactor: 1.4,
        align: orgAlign,
        maxWidth: contentWidth * 0.48,
      });
      // `.live-document__organization { gap: 0.28em }` — already partly in line-height;
      // keep a tiny extra like the flex gap without looking double-spaced.
      orgY += emMm(sizeOrgDetails, 0.06);
    }
  }

  if (settings.header.showDocumentTitle) {
    titleY = drawLines(
      settings.transactionLabels.documentTitle,
      titleX,
      titleY,
      {
        bold: true,
        size: sizeTitle,
        align: titleAlign,
        lineFactor: 1.15,
        color: headingRgb,
      },
    );
    titleY += emMm(sizeBody, 0.2);
  }
  if (settings.header.showOrderNumber) {
    titleY = drawLines(
      `${asText(settings.transactionLabels.orderNumber)} ${asText(documentNumber)}`,
      titleX,
      titleY,
      {
        bold: true,
        size: sizeOrderNo,
        align: titleAlign,
        color: orderNumberRgb,
      },
    );
  }

  // Light-grey Order Date / Ref# box under the title (matches live CSS).
  const metaRows: Array<[string, string]> = [];
  if (settings.header.showDate) {
    metaRows.push([settings.transactionLabels.date, orderDate]);
  }
  metaRows.push([
    settings.transactionLabels.reference,
    order.referenceNumber || order.name,
  ]);
  if (
    settings.header.showExpectedShipmentDate &&
    order.expectedShipmentDate
  ) {
    metaRows.push([
      settings.transactionLabels.expectedShipmentDate,
      order.expectedShipmentDate,
    ]);
  }
  if (settings.header.showPaymentMethod && order.paymentMethod) {
    metaRows.push([
      settings.transactionLabels.paymentMethod,
      order.paymentMethod,
    ]);
  }
  if (metaRows.length > 0) {
    // Match loosened `.live-document__metadata` spacing (no label/value collision).
    titleY += emMm(sizeBody, 1.5);
    setFont("normal", sizeMetadata);

    const colGap = Math.max(8, emMm(sizeMetadata, 2));
    const metaPadX = Math.max(3.2, emMm(sizeMetadata, 1.15));
    const metaPadY = Math.max(3.4, emMm(sizeMetadata, 1));
    const rowGap = Math.max(3.2, emMm(sizeMetadata, 0.75));
    const rowH = lineStep(sizeMetadata, 1.6);

    let maxLabelW = 0;
    let maxValueW = 0;
    const rawRows = metaRows.map(([label, value]) => {
      const labelText = asText(label);
      const valueText = asText(value);
      maxLabelW = Math.max(maxLabelW, pdf.getTextWidth(labelText));
      maxValueW = Math.max(maxValueW, pdf.getTextWidth(valueText));
      return { labelText, valueText };
    });

    // Always reserve full label + gap + value widths (content-sized box).
    let metaW = metaPadX * 2 + maxLabelW + colGap + maxValueW + 1;
    const maxAllowed = Math.min(contentWidth * 0.72, contentWidth - 2);
    let valueColW = maxValueW;
    if (metaW > maxAllowed) {
      const fixed = metaPadX * 2 + maxLabelW + colGap + 1;
      valueColW = Math.max(22, maxAllowed - fixed);
      metaW = maxAllowed;
    }

    const measuredRows = rawRows.map((row) => {
      const valueLines =
        pdf.getTextWidth(row.valueText) <= valueColW + 0.4
          ? [row.valueText]
          : (pdf.splitTextToSize(row.valueText, valueColW) as string[]);
      return { labelText: row.labelText, valueLines };
    });

    const rowsH = measuredRows.reduce((sum, row, index) => {
      const linesH = Math.max(1, row.valueLines.length) * rowH;
      const gapAfter = index < measuredRows.length - 1 ? rowGap : 0;
      return sum + linesH + gapAfter;
    }, 0);
    const metaBoxH = metaPadY * 2 + rowsH;

    const metaX = logoOnRight
      ? titleX
      : Math.max(margin.left, titleX - metaW);
    const labelX = metaX + metaPadX;
    // Value column starts AFTER label column + gap (never overlaps label).
    const valueLeft = labelX + maxLabelW + colGap;
    const valueRight = metaX + metaW - metaPadX;

    pdf.setFillColor(242, 242, 242);
    pdf.rect(metaX, titleY, metaW, metaBoxH, "F");

    let metaY = titleY + metaPadY + rowH * 0.78;
    for (const row of measuredRows) {
      setFont("normal", sizeMetadata);
      pdf.setTextColor(...mutedRgb);
      pdf.text(row.labelText, labelX, metaY);

      setFont("normal", sizeMetadata);
      pdf.setTextColor(...textRgb);
      let lineY = metaY;
      for (const line of row.valueLines) {
        pdf.text(line, valueRight, lineY, { align: "right" });
        lineY += rowH;
      }
      metaY += Math.max(1, row.valueLines.length) * rowH + rowGap;
    }

    titleY = titleY + metaBoxH + emMm(sizeBody, 0.6);
  }

  leftY = logoOnRight ? titleY : orgY;
  rightY = logoOnRight ? orgY : titleY;

  // Clear space before Bill To / Ship To / Customer Details
  // `.live-document__header { margin-bottom: 3em }`
  y = Math.max(leftY, rightY, headerTop) + emMm(sizeBody, 3.0);

  // Bill To / Ship To / Customer Details — fixed 3 slots (same positions
  // whether a section is hidden or shown; empty slots stay blank).
  const partySlots = [
    settings.header.showBilling
      ? {
          label: settings.transactionLabels.customer,
          fields: settings.billingDetails,
          party: order.billing,
        }
      : null,
    settings.header.showShipping
      ? {
          label: settings.transactionLabels.shipping,
          fields: settings.shippingDetails,
          party: order.shipping,
        }
      : null,
    settings.header.showCustomerDetails
      ? {
          label: settings.transactionLabels.customerDetails,
          fields: settings.customerBlockDetails,
          party: order.customer,
        }
      : null,
  ];

  if (partySlots.some(Boolean)) {
    ensureSpace(40);
    const partySlotCount = 3;
    const gap = contentWidth * 0.07;
    const colW =
      (contentWidth - gap * (partySlotCount - 1)) / partySlotCount;

    const drawPartyColumn = (
      label: string,
      x: number,
      fields: TemplateEditorSettings["billingDetails"],
      party: SalesOrderDocumentData["billing"],
      startY: number,
    ) => {
      let colY = drawLines(label, x, startY, {
        size: sizeAddressLabel,
        color: mutedRgb,
        lineFactor: 1.4,
      });
      colY += emMm(sizeAddressLabel, 0.35);
      for (const line of partyLines(fields, party)) {
        const lineSize =
          line.sizeKind === "company"
            ? sizeCompany
            : line.sizeKind === "name"
              ? sizeCustomerName
              : sizeCustomerDetails;
        const lineColor =
          line.sizeKind === "company"
            ? companyRgb
            : line.sizeKind === "name"
              ? customerNameRgb
              : customerDetailsRgb;
        colY = drawLines(line.text, x, colY, {
          bold: line.bold,
          size: lineSize,
          color: lineColor,
          maxWidth: colW,
          lineFactor: 1.45,
        });
        colY += emMm(sizeCustomerDetails, 0.12);
      }
      return colY;
    };

    let maxColY = y;
    partySlots.forEach((column, index) => {
      if (!column) return;
      const colX = margin.left + index * (colW + gap);
      const colY = drawPartyColumn(
        column.label,
        colX,
        column.fields,
        column.party,
        y,
      );
      maxColY = Math.max(maxColY, colY);
    });

    // `.live-document__details { margin-bottom: 1.85em }`
    y = maxColY + emMm(sizeBody, 1.85);
  }

  // Table — match live CSS: pad 0.75/0.85em, wrap titles, strike compare price
  const cellPadX = emMm(sizeTable, 0.55);
  const headerPadY = emMm(sizeTableHeader, 0.7);
  const bodyPadY = emMm(sizeTable, 0.85);
  const bodyLineH = lineStep(sizeTable, 1.4);
  const headerLineH = lineStep(sizeTableHeader, 1.25);
  const compareSize = Math.max(7, sizeTable - 1);
  const compareLineH = lineStep(compareSize, 1.3);
  const numericKeys = new Set([
    "quantity",
    "rate",
    "discount",
    "discountPercentage",
    "taxPercentage",
    "taxAmount",
    "amount",
  ]);

  let colWidths = columns.map(
    (column) => (Math.max(column.width, 1) / totalColWidth) * contentWidth,
  );

  // Keep headers like "Discount" on one line — raise floors, shrink Item first.
  setFont("bold", sizeTableHeader);
  const headerMins = columns.map((column) => {
    const needed = pdf.getTextWidth(asText(column.label)) + cellPadX * 2 + 1.5;
    if (column.key === "item") return Math.max(needed, contentWidth * 0.22);
    if (column.key === "number") return Math.max(needed, 7);
    return Math.min(Math.max(needed, 12), contentWidth * 0.2);
  });
  colWidths = colWidths.map((width, i) => Math.max(width, headerMins[i]!));
  const widthSum = colWidths.reduce((sum, width) => sum + width, 0);
  if (widthSum > contentWidth + 0.01) {
    let overflow = widthSum - contentWidth;
    const itemIdx = columns.findIndex((column) => column.key === "item");
    if (itemIdx >= 0) {
      const minItem = contentWidth * 0.2;
      const reducible = Math.max(0, colWidths[itemIdx]! - minItem);
      const take = Math.min(overflow, reducible);
      colWidths[itemIdx] = colWidths[itemIdx]! - take;
      overflow -= take;
    }
    if (overflow > 0.01) {
      const flexible = colWidths.map((width, i) =>
        Math.max(0, width - headerMins[i]!),
      );
      const flexibleSum = flexible.reduce((sum, width) => sum + width, 0);
      if (flexibleSum > 0) {
        colWidths = colWidths.map((width, i) => {
          const share = (flexible[i]! / flexibleSum) * overflow;
          return Math.max(headerMins[i]!, width - share);
        });
      } else {
        const scale = contentWidth / colWidths.reduce((sum, width) => sum + width, 0);
        colWidths = colWidths.map((width) => width * scale);
      }
    }
  }

  const wrapCell = (text: string, width: number, size: number) => {
    setFont("normal", size);
    const maxW = Math.max(width - cellPadX * 2, 4);
    return pdf.splitTextToSize(asText(text) || "-", maxW) as string[];
  };

  // Prefer single-line headers; wrap only if still too narrow after floors.
  const headerWrapped = columns.map((column, i) => {
    setFont("bold", sizeTableHeader);
    const maxW = Math.max(colWidths[i]! - cellPadX * 2, 4);
    const label = asText(column.label);
    if (pdf.getTextWidth(label) <= maxW) return [label];
    return pdf.splitTextToSize(label, maxW) as string[];
  });
  const headerLines = Math.max(1, ...headerWrapped.map((lines) => lines.length));
  const headerRowH = headerPadY * 2 + headerLines * headerLineH;
  ensureSpace(headerRowH + 8);

  pdf.setFillColor(...tableHeaderBg);
  pdf.rect(margin.left, y, contentWidth, headerRowH, "F");
  setFont("bold", sizeTableHeader);
  pdf.setTextColor(...tableHeaderText);

  let headerX = margin.left;
  columns.forEach((column, i) => {
    const width = colWidths[i];
    const isNumeric = numericKeys.has(column.key);
    let lineY = y + headerPadY + headerLineH * 0.75;
    for (const line of headerWrapped[i]) {
      pdf.text(
        line,
        isNumeric ? headerX + width - cellPadX : headerX + cellPadX,
        lineY,
        { align: isNumeric ? "right" : "left" },
      );
      lineY += headerLineH;
    }
    headerX += width;
  });
  y += headerRowH;

  const showComparePrice = Boolean(
    columns.find((column) => column.key === "rate")?.showComparePrice,
  );
  const itemColumnSettings = columns.find((column) => column.key === "item");
  const showItemImages = Boolean(itemColumnSettings?.showImage);
  const itemImageSizeMm = lineItemImageSizeMm(itemColumnSettings?.imageSize);
  const itemImageGapMm = showItemImages ? 1.6 : 0;
  const itemImageCache = new Map<
    string,
    { dataUrl: string; format: "PNG" | "JPEG" }
  >();
  if (showItemImages) {
    const uniqueUrls = [
      ...new Set(
        order.lineItems
          .map((item) => item.imageUrl?.trim() || "")
          .filter(Boolean),
      ),
    ];
    await Promise.all(
      uniqueUrls.map(async (url) => {
        const loaded = await loadRemoteImageDataUrl(url);
        if (loaded) itemImageCache.set(url, loaded);
      }),
    );
  }

  order.lineItems.forEach((item, index) => {
    const itemLines = itemColumnLines(item);
    const displayedRate = resolveDisplayedUnitPrice(item, showComparePrice);
    const showCompare = Boolean(displayedRate.compareAtPrice);
    const itemColIndex = columns.findIndex((column) => column.key === "item");
    const itemColWidth =
      itemColIndex >= 0 ? colWidths[itemColIndex] : contentWidth * 0.3;
    const itemImage =
      showItemImages && item.imageUrl
        ? itemImageCache.get(item.imageUrl.trim())
        : undefined;
    const itemTextOffset =
      itemImage != null ? itemImageSizeMm + itemImageGapMm : 0;
    const itemTextWidth = Math.max(8, itemColWidth - cellPadX * 2 - itemTextOffset);
    const titleWrapCount =
      itemLines.length > 0
        ? wrapCell(itemLines[0], itemTextWidth, sizeTable).length
        : 0;

    // Pre-wrap every cell so row height matches content (no clipped titles).
    const cellLines: string[][] = columns.map((column, i) => {
      const width = colWidths[i];
      if (column.key === "item") {
        const lines: string[] = [];
        itemLines.forEach((part) => {
          lines.push(...wrapCell(part, itemTextWidth, sizeTable));
        });
        return lines.length > 0 ? lines : ["-"];
      }
      if (column.key === "rate") {
        return [displayedRate.rate || "0,00"];
      }
      // Numeric cells are nowrap in live CSS — keep a single line.
      if (numericKeys.has(column.key)) {
        return [cellValue(column.key, item, index, settings) || "-"];
      }
      return wrapCell(
        cellValue(column.key, item, index, settings),
        width,
        sizeTable,
      );
    });

    let contentH = bodyLineH;
    columns.forEach((column, i) => {
      if (column.key === "rate" && showCompare) {
        contentH = Math.max(
          contentH,
          bodyLineH + compareLineH + emMm(sizeTable, 0.15),
        );
      } else if (column.key === "item" && itemImage) {
        contentH = Math.max(
          contentH,
          Math.max(
            itemImageSizeMm,
            Math.max(1, cellLines[i].length) * bodyLineH,
          ),
        );
      } else {
        contentH = Math.max(
          contentH,
          Math.max(1, cellLines[i].length) * bodyLineH,
        );
      }
    });
    const itemRowH = bodyPadY * 2 + contentH;

    ensureSpace(itemRowH + 2);
    if (index % 2 === 1) {
      pdf.setFillColor(248, 248, 248);
      pdf.rect(margin.left, y, contentWidth, itemRowH, "F");
    }

    let cellX = margin.left;
    const contentTop = y + bodyPadY;
    const cellTextTop = (blockH: number) =>
      contentTop + Math.max(0, (contentH - blockH) / 2) + bodyLineH * 0.7;
    columns.forEach((column, i) => {
      const width = colWidths[i];
      const isNumeric = numericKeys.has(column.key);
      const lines = cellLines[i];

      if (column.key === "rate") {
        const rateBlockH = showCompare
          ? bodyLineH + compareLineH + emMm(sizeTable, 0.15)
          : bodyLineH;
        const rateTop = cellTextTop(rateBlockH);
        setFont("normal", sizeTable);
        pdf.setTextColor(...unitPriceRgb);
        pdf.text(lines[0] ?? "-", cellX + width - cellPadX, rateTop, {
          align: "right",
        });
        if (showCompare) {
          const compareY = rateTop + compareLineH + emMm(sizeTable, 0.1);
          setFont("normal", compareSize);
          pdf.setTextColor(...comparePriceRgb);
          const compareLabel = displayedRate.compareAtPrice;
          pdf.text(compareLabel, cellX + width - cellPadX, compareY, {
            align: "right",
          });
          // Strikethrough — matches `.live-document__compare-price`
          const strikeW = pdf.getTextWidth(compareLabel);
          const strikeY = compareY - compareSize * PT_TO_MM * 0.32;
          pdf.setDrawColor(...comparePriceRgb);
          pdf.setLineWidth(0.2);
          pdf.line(
            cellX + width - cellPadX - strikeW,
            strikeY,
            cellX + width - cellPadX,
            strikeY,
          );
          setFont("normal", sizeTable);
        }
        pdf.setTextColor(...textRgb);
      } else if (column.key === "item") {
        let textX = cellX + cellPadX;
        const textBlockH = Math.max(1, lines.length) * bodyLineH;
        const itemBlockH = itemImage
          ? Math.max(itemImageSizeMm, textBlockH)
          : textBlockH;
        const itemBlockTop =
          contentTop + Math.max(0, (contentH - itemBlockH) / 2);
        if (itemImage) {
          try {
            const imageY =
              itemBlockTop + Math.max(0, (itemBlockH - itemImageSizeMm) / 2);
            pdf.addImage(
              itemImage.dataUrl,
              itemImage.format,
              textX,
              imageY,
              itemImageSizeMm,
              itemImageSizeMm,
            );
          } catch {
            // Skip broken product images; continue with text.
          }
          textX += itemImageSizeMm + itemImageGapMm;
        }
        let lineY =
          itemBlockTop +
          Math.max(0, (itemBlockH - textBlockH) / 2) +
          bodyLineH * 0.7;
        lines.forEach((line, lineIndex) => {
          const isVariant =
            itemLines.length > 1 && lineIndex >= titleWrapCount;
          setFont("normal", sizeTable);
          pdf.setTextColor(...(isVariant ? mutedRgb : textRgb));
          pdf.text(line, textX, lineY, { align: "left" });
          lineY += bodyLineH;
        });
        pdf.setTextColor(...textRgb);
      } else {
        setFont("normal", sizeTable);
        pdf.setTextColor(...textRgb);
        const textBlockH = Math.max(1, lines.length) * bodyLineH;
        let lineY = cellTextTop(textBlockH);
        for (const line of lines) {
          pdf.text(
            line,
            isNumeric ? cellX + width - cellPadX : cellX + cellPadX,
            lineY,
            { align: isNumeric ? "right" : "left" },
          );
          lineY += bodyLineH;
        }
      }
      cellX += width;
    });

    // Row divider like `border-bottom: 1px solid #dedede`
    pdf.setDrawColor(222, 222, 222);
    pdf.setLineWidth(0.15);
    pdf.line(
      margin.left,
      y + itemRowH,
      margin.left + contentWidth,
      y + itemRowH,
    );

    y += itemRowH;
  });

  if (settings.totals.showQuantity) {
    y += emMm(sizeBody, 0.35);
    setFont("normal", sizeTable);
    pdf.setTextColor(...textRgb);
    const itemsInTotalText = `${settings.totals.itemsInTotalLabel}: ${computeTotalItemQuantity(order.lineItems)}`;
    pdf.text(itemsInTotalText, margin.left, y + bodyLineH * 0.7);
    y += bodyLineH + emMm(sizeBody, 0.25);
  }

  // Totals — keep the whole block on one page (no mid-row splits)
  y += contentWidth * 0.02 + emMm(sizeBody, 0.2);
  const totalsW = contentWidth * 0.43;
  const totalsX = margin.left + contentWidth - totalsW;
  const totalsPadX = emMm(sizeTotals, 0.8);
  const totals: Array<{
    label: string;
    value: string;
    strong?: boolean;
    payment?: boolean;
  }> = [];

  if (settings.totals.showSubtotal) {
    totals.push({
      label: settings.totals.subtotalLabel,
      value: formatAmountDisplay(order.subtotal),
    });
  }
  if (settings.totals.showTaxLines) {
    const taxLines =
      (order.taxSummary?.length ?? 0) > 0
        ? order.taxSummary
        : buildTaxSummaryFromLineItems(order.lineItems);
    for (const row of taxLines) {
      if (!hasNonZeroAmount(row.taxAmount)) continue;
      totals.push({
        label: formatTaxLineLabel(row),
        value: formatAmountDisplay(row.taxAmount),
      });
    }
  }
  if (
    settings.totals.showDiscountAmount &&
    hasNonZeroAmount(order.discount)
  ) {
    totals.push({
      label: settings.totals.discountAmountLabel,
      value: formatAmountDisplay(order.discount),
    });
  }
  if (
    settings.totals.showShippingPrice &&
    hasNonZeroAmount(order.shippingPrice)
  ) {
    totals.push({
      label: settings.totals.shippingPriceLabel,
      value: formatAmountDisplay(order.shippingPrice),
    });
  }
  if (settings.totals.showVatAmount && hasNonZeroAmount(order.tax)) {
    totals.push({
      label: settings.totals.vatAmountLabel,
      value: formatAmountDisplay(order.tax),
    });
  }

  const paymentStatusStyle = normalizePaymentStatusStyle(
    settings.totals.paymentStatusStyle,
  );
  const paymentStatusCells = [
    shouldShowDocumentPaidAmount(order, settings.totals.showPaidAmount)
      ? {
          label: settings.totals.paidAmountLabel,
          value: `${prefix}${formatAmountDisplay(order.paidAmount)}`,
        }
      : null,
    shouldShowDocumentRefundedAmount(order)
      ? {
          label: settings.totals.refundedAmountLabel,
          value: `${prefix}${formatAmountDisplay(order.refundedAmount)}`,
        }
      : null,
    shouldShowDocumentBalanceDue(order, settings.totals.showBalanceDue)
      ? {
          label: settings.totals.balanceDueLabel,
          value: `${prefix}${formatAmountDisplay(order.balanceDue)}`,
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  totals.push({
    label: settings.totals.totalLabel,
    value: `${prefix}${formatAmountDisplay(order.total)}`,
    strong: true,
  });

  if (paymentStatusStyle === "inTotals") {
    for (const cell of paymentStatusCells) {
      totals.push({ label: cell.label, value: cell.value, strong: true });
    }
  }

  if (
    paymentStatusStyle === "underTotal" ||
    paymentStatusStyle === "balanceBanner"
  ) {
    for (const cell of paymentStatusCells) {
      totals.push({
        label: cell.label,
        value: cell.value,
        strong: true,
        payment: true,
      });
    }
  }

  const totalsBlockH = totals.reduce((sum, row) => {
    const rowSize = row.strong ? sizeTotal : sizeTotals;
    // Match CSS: normal 0.9em pad + 1.65 lh; grand-total 1.15em pad + 1.7 lh
    const totalsPadY = emMm(rowSize, row.strong ? 1.15 : 0.9);
    const lh = row.strong ? 1.7 : 1.65;
    return sum + lineStep(rowSize, lh) + totalsPadY * 2;
  }, 0);

  const splitPanelsH =
    paymentStatusStyle === "splitPanels" && paymentStatusCells.length > 0
      ? (emMm(sizePaymentStatusLabel, 0.7) * 2 +
          lineStep(
            Math.max(sizePaymentStatusLabel, sizePaymentStatusValue),
            1.35,
          ) +
          emMm(sizeBody, 0.55)) *
          paymentStatusCells.length +
        emMm(sizeBody, 0.55)
      : 0;

  const boxedPaymentH =
    paymentStatusStyle === "boxed" && paymentStatusCells.length > 0
      ? emMm(Math.max(sizePaymentStatusLabel, sizePaymentStatusValue), 0.75) *
          2 +
        lineStep(Math.max(sizePaymentStatusLabel, sizePaymentStatusValue), 1.35) +
        emMm(sizeBody, 1.35)
      : 0;

  ensureSpace(totalsBlockH + splitPanelsH + boxedPaymentH + 4);

  // Measure widest totals value so the label↔value gap matches CSS `gap: 2.75em`.
  let maxTotalsValueW = emMm(sizeTotals, 5.5);
  for (const row of totals) {
    const rowSize = row.strong ? sizeTotal : sizeTotals;
    setFont(row.strong || row.payment ? "bold" : "normal", rowSize);
    maxTotalsValueW = Math.max(
      maxTotalsValueW,
      pdf.getTextWidth(asText(row.value)),
    );
  }

  const drawTotalsRow = (row: (typeof totals)[number]) => {
    const rowSize = row.strong ? sizeTotal : sizeTotals;
    const totalsPadY = emMm(rowSize, row.strong ? 1.15 : 0.9);
    const lh = row.strong ? 1.7 : 1.65;
    const totalsRowH = lineStep(rowSize, lh) + totalsPadY * 2;
    if (row.strong) {
      pdf.setFillColor(...totalBg);
      pdf.rect(totalsX, y, totalsW, totalsRowH, "F");
      setFont("bold", rowSize);
    } else if (row.payment) {
      setFont("bold", rowSize);
    } else {
      setFont("normal", rowSize);
    }
    const textY = y + totalsPadY + lineStep(rowSize, lh) * 0.7;
    const labelValueGap = emMm(rowSize, 2.75);
    const valueX = totalsX + totalsW - totalsPadX;
    const labelX = valueX - maxTotalsValueW - labelValueGap;
    if (row.payment && !row.strong) {
      pdf.setTextColor(...paymentStatusLabelRgb);
      pdf.text(asText(row.label), labelX, textY, { align: "right" });
      pdf.setTextColor(...paymentStatusValueRgb);
      pdf.text(asText(row.value), valueX, textY, { align: "right" });
    } else {
      pdf.setTextColor(...textRgb);
      pdf.text(asText(row.label), labelX, textY, { align: "right" });
      pdf.text(asText(row.value), valueX, textY, { align: "right" });
    }
    y += totalsRowH;
  };

  for (const row of totals) {
    drawTotalsRow(row);
  }

  if (paymentStatusStyle === "splitPanels" && paymentStatusCells.length > 0) {
    y += emMm(sizeBody, 0.55);
    const gap = emMm(sizeBody, 0.55);
    const padX = emMm(sizePaymentStatusLabel, 0.75);
    const padY = emMm(sizePaymentStatusLabel, 0.7);
    const rowH = lineStep(
      Math.max(sizePaymentStatusLabel, sizePaymentStatusValue),
      1.35,
    );
    const panelH = padY * 2 + rowH;
    ensureSpace(
      panelH * paymentStatusCells.length +
        gap * (paymentStatusCells.length - 1) +
        2,
    );

    paymentStatusCells.forEach((cell, index) => {
      if (index === paymentStatusCells.length - 1 && paymentStatusCells.length > 1) {
        const soft = totalBg.map((c) => Math.round(c * 0.7 + 255 * 0.3)) as [
          number,
          number,
          number,
        ];
        pdf.setFillColor(...soft);
        pdf.rect(totalsX, y, totalsW, panelH, "F");
      }
      pdf.setDrawColor(...paymentStatusBorderRgb);
      pdf.setLineWidth(0.25);
      pdf.rect(totalsX, y, totalsW, panelH, "S");
      const textY = y + padY + rowH * 0.75;
      setFont("bold", sizePaymentStatusLabel);
      pdf.setTextColor(...paymentStatusLabelRgb);
      pdf.text(asText(cell.label).toUpperCase(), totalsX + padX, textY);
      setFont("bold", sizePaymentStatusValue);
      pdf.setTextColor(...paymentStatusValueRgb);
      pdf.text(asText(cell.value), totalsX + totalsW - padX, textY, {
        align: "right",
      });
      y += panelH + (index < paymentStatusCells.length - 1 ? gap : 0);
    });
  }

  if (paymentStatusStyle === "boxed" && paymentStatusCells.length > 0) {
    y += emMm(sizeBody, 1.35);
    const segments = paymentStatusCells.flatMap((cell) => [
      { kind: "label" as const, text: cell.label },
      { kind: "value" as const, text: cell.value },
    ]);
    const segmentCount = segments.length;
    const boxW = contentWidth;
    const statusSize = Math.max(sizePaymentStatusLabel, sizePaymentStatusValue);
    const padX = emMm(statusSize, 1);
    const padY = emMm(statusSize, 0.75);
    const rowH = lineStep(statusSize, 1.35);
    const boxH = padY * 2 + rowH;
    ensureSpace(boxH + 2);

    pdf.setDrawColor(...paymentStatusBorderRgb);
    pdf.setLineWidth(0.25);
    pdf.setLineDashPattern([1.2, 1.2], 0);
    pdf.rect(margin.left, y, boxW, boxH, "S");

    const segmentW = boxW / segmentCount;
    segments.forEach((segment, index) => {
      const segmentX = margin.left + index * segmentW;
      if (index > 0) {
        pdf.line(segmentX, y, segmentX, y + boxH);
      }
      const textY = y + padY + rowH * 0.75;
      const centerX = segmentX + segmentW / 2;
      setFont(
        "bold",
        segment.kind === "label" ? sizePaymentStatusLabel : sizePaymentStatusValue,
      );
      if (segment.kind === "label") {
        pdf.setTextColor(...paymentStatusLabelRgb);
        pdf.text(asText(segment.text).toUpperCase(), centerX, textY, {
          align: "center",
        });
      } else {
        pdf.setTextColor(...paymentStatusValueRgb);
        pdf.text(asText(segment.text), centerX, textY, { align: "center" });
      }
    });
    pdf.setLineDashPattern([], 0);
    y += boxH;
  }

  // Footer — Tax Summary, then Notes, then Terms
  y += emMm(sizeBody, 2.4);
  ensureSpace(24);

  const taxSummarySource = reconcileTaxSummaryToOrderTotal(
    (order.taxSummary?.length ?? 0) > 0
      ? order.taxSummary
      : buildTaxSummaryFromLineItems(order.lineItems),
    order.total,
    order.tax,
  );
  const taxSummaryRows = taxSummaryDisplayRows(taxSummarySource);
  const taxTotals = taxSummaryTotals(taxSummarySource, order.total);
  const moneySymbol = currencySymbol(order.currencyCode);
  const taxSummaryConfig = settings.taxSummary;
  const taxSummaryEnabled = taxSummaryConfig?.enabled !== false;
  const showTaxable = taxSummaryConfig?.showTaxableAmount !== false;
  const showTaxAmt = taxSummaryConfig?.showTaxAmount !== false;
  const showTotalAmt = taxSummaryConfig?.showTotalAmount !== false;
  if (taxSummaryEnabled && taxSummaryRows.length > 0) {
    const taxSummaryW = contentWidth;
    const visibleCols =
      1 +
      (showTaxable ? 1 : 0) +
      (showTaxAmt ? 1 : 0) +
      (showTotalAmt ? 1 : 0);
    const detailsW = taxSummaryW * (visibleCols === 1 ? 1 : 0.34);
    const amountW =
      visibleCols > 1 ? (taxSummaryW - detailsW) / (visibleCols - 1) : 0;
    const taxColWs = [
      detailsW,
      ...(showTaxable ? [amountW] : []),
      ...(showTaxAmt ? [amountW] : []),
      ...(showTotalAmt ? [amountW] : []),
    ];
    const taxHeaders = [
      resolveTaxSummaryLabel(
        taxSummaryConfig?.detailsLabel || "Tax Details",
        moneySymbol,
      ),
      ...(showTaxable
        ? [
            resolveTaxSummaryLabel(
              taxSummaryConfig?.taxableAmountLabel ||
                "Taxable Amount ({currency})",
              moneySymbol,
            ),
          ]
        : []),
      ...(showTaxAmt
        ? [
            resolveTaxSummaryLabel(
              taxSummaryConfig?.taxAmountLabel || "Tax Amount ({currency})",
              moneySymbol,
            ),
          ]
        : []),
      ...(showTotalAmt
        ? [
            resolveTaxSummaryLabel(
              taxSummaryConfig?.totalAmountLabel ||
                "Total Amount ({currency})",
              moneySymbol,
            ),
          ]
        : []),
    ];
    const taxRowH = lineStep(sizeTaxSummaryBody, 1.35) + emMm(sizeTaxSummaryBody, 0.9);
    const taxHeaderH =
      lineStep(sizeTaxSummaryHeader, 1.2) + emMm(sizeTaxSummaryHeader, 1.0);
    ensureSpace(
      taxHeaderH +
        taxRowH * (taxSummaryRows.length + 1) +
        emMm(sizeBody, 1.2),
    );

    y = drawLines(taxSummaryConfig?.title || "Tax Summary", margin.left, y, {
      bold: true,
      size: sizeTaxSummaryTitle,
      color: taxSummaryTitleRgb,
    });
    y += emMm(sizeTaxSummaryTitle, 0.35);

    pdf.setFillColor(...taxSummaryHeaderBg);
    pdf.rect(margin.left, y, taxSummaryW, taxHeaderH, "F");
    setFont("bold", Math.max(7, sizeTaxSummaryHeader - 1));
    pdf.setTextColor(...taxSummaryHeaderTextRgb);
    let taxX = margin.left;
    taxHeaders.forEach((header, index) => {
      const colW = taxColWs[index];
      const pad = emMm(sizeTaxSummaryHeader, 0.3);
      const textY = y + taxHeaderH * 0.68;
      const lines = pdf.splitTextToSize(header, colW - pad * 2) as string[];
      if (index === 0) {
        pdf.text(lines[0] ?? header, taxX + pad, textY);
      } else {
        pdf.text(lines[0] ?? header, taxX + colW - pad, textY, {
          align: "right",
        });
      }
      taxX += colW;
    });
    y += taxHeaderH;

    setFont("normal", sizeTaxSummaryBody);
    pdf.setTextColor(...taxSummaryTextRgb);
    pdf.setDrawColor(...taxSummaryBorderRgb);
    pdf.setLineWidth(0.15);
    for (const row of taxSummaryRows) {
      const cells = [
        row.details,
        ...(showTaxable ? [row.taxableAmount] : []),
        ...(showTaxAmt ? [row.taxAmount] : []),
        ...(showTotalAmt ? [row.totalAmount] : []),
      ];
      taxX = margin.left;
      cells.forEach((cell, index) => {
        const colW = taxColWs[index];
        const pad = emMm(sizeTaxSummaryBody, 0.35);
        const textY = y + taxRowH * 0.68;
        if (index === 0) {
          pdf.text(asText(cell), taxX + pad, textY);
        } else {
          pdf.text(asText(cell), taxX + colW - pad, textY, { align: "right" });
        }
        taxX += colW;
      });
      pdf.line(
        margin.left,
        y + taxRowH,
        margin.left + taxSummaryW,
        y + taxRowH,
      );
      y += taxRowH;
    }

    // Total row
    setFont("bold", sizeTaxSummaryBody);
    pdf.setTextColor(...taxSummaryTextRgb);
    const totalCells = [
      taxSummaryConfig?.totalLabel || "Total",
      ...(showTaxable ? [`${moneySymbol}${taxTotals.taxableAmount}`] : []),
      ...(showTaxAmt ? [`${moneySymbol}${taxTotals.taxAmount}`] : []),
      ...(showTotalAmt ? [`${moneySymbol}${taxTotals.totalAmount}`] : []),
    ];
    taxX = margin.left;
    totalCells.forEach((cell, index) => {
      const colW = taxColWs[index];
      const pad = emMm(sizeTaxSummaryBody, 0.35);
      const textY = y + taxRowH * 0.68;
      if (index === 0) {
        pdf.text(cell, taxX + pad, textY);
      } else {
        pdf.text(cell, taxX + colW - pad, textY, { align: "right" });
      }
      taxX += colW;
    });
    pdf.setDrawColor(...taxSummaryTextRgb);
    pdf.setLineWidth(0.35);
    pdf.line(
      margin.left,
      y + taxRowH,
      margin.left + taxSummaryW,
      y + taxRowH,
    );
    y += taxRowH;
    y += emMm(sizeBody, 2.2);
  }

  ensureSpace(24);
  y = drawLines(settings.notesLabel, margin.left, y, {
    bold: true,
    size: sizeNotesLabel,
    color: notesLabelRgb,
  });
  y += emMm(sizeNotesLabel, 0.45);
  y = drawLines(settings.notes || "", margin.left, y, {
    size: sizeNotesBody,
    color: notesBodyRgb,
    maxWidth: contentWidth * 0.55,
    lineFactor: 1.4,
  });

  y += emMm(sizeBody, 2.2);
  ensureSpace(16);
  y = drawLines(settings.termsLabel, margin.left, y, {
    bold: true,
    size: sizeTermsLabel,
    color: termsLabelRgb,
  });
  y += emMm(sizeTermsLabel, 0.45);
  y = drawLines(settings.terms || "", margin.left, y, {
    size: sizeTermsBody,
    color: termsBodyRgb,
    maxWidth: contentWidth,
    lineFactor: 1.4,
  });

  if (settings.showSignature || settings.showStamp) {
    y += emMm(sizeBody, 2.0);
    ensureSpace(settings.showStamp ? 28 : 16);
    const endorsementsTop = y;

    if (settings.showSignature) {
      const sigWidth = 50;
      const sigX = margin.left;
      pdf.setDrawColor(138, 138, 138);
      pdf.line(sigX, endorsementsTop, sigX + sigWidth, endorsementsTop);
      drawLines(
        "Authorized Signature",
        sigX + sigWidth / 2,
        endorsementsTop + emMm(sizeBody, 0.8),
        {
          size: sizeSmall,
          align: "center",
          maxWidth: sigWidth,
        },
      );
    }

    if (settings.showStamp) {
      const stampLineWidth = 50;
      const stampX = margin.left + contentWidth - stampLineWidth;
      pdf.setDrawColor(138, 138, 138);
      pdf.line(stampX, endorsementsTop, stampX + stampLineWidth, endorsementsTop);
      drawLines(
        "Company Stamp",
        stampX + stampLineWidth / 2,
        endorsementsTop + emMm(sizeBody, 0.8),
        {
          size: sizeSmall,
          align: "center",
          maxWidth: stampLineWidth,
        },
      );
    }

    y = endorsementsTop + emMm(sizeBody, 2.0);
  }

  return pdf;
}

export async function buildSalesOrderPdfBytes(args: PdfArgs) {
  const pdf = await buildSalesOrderVectorPdf(args);
  const buffer = pdf.output("arraybuffer");
  return new Uint8Array(buffer);
}

export async function downloadSalesOrderVectorPdf(args: PdfArgs) {
  const pdf = await buildSalesOrderVectorPdf(args);
  const label = args.order.documentNumber || args.order.name;
  pdf.save(salesOrderPdfFileName(label));
}

type TemplateExportSettings = Pick<
  TemplateEditorSettings,
  "paperSize" | "orientation" | "backgroundColor" | "fontFamily" | "margins"
>;

const PX_PER_MM = 96 / 25.4;
/** Higher scale = sharper PDF (still matches on-screen layout 1:1). */
const CAPTURE_SCALE = 4;

function paperSizeMm(
  paperSize: TemplateEditorSettings["paperSize"],
  orientation: TemplateEditorSettings["orientation"],
) {
  const base =
    paperSize === "Letter"
      ? { width: 215.9, height: 279.4 }
      : paperSize === "A5"
        ? { width: 148, height: 210 }
        : { width: 210, height: 297 };

  if (orientation === "landscape") {
    return { width: base.height, height: base.width };
  }
  return base;
}

function jsPdfFormat(
  paperSize: TemplateEditorSettings["paperSize"],
): string | number[] {
  if (paperSize === "Letter") return "letter";
  if (paperSize === "A5") return "a5";
  return "a4";
}

async function loadHtml2Canvas() {
  const mod = await import("html2canvas");
  return mod.default;
}

/** Totals payment chrome — exclude from label/value row hardening. */
const TOTALS_ROW_EXCLUSION =
  ":not(.live-document__payment-split-panels):not(.live-document__payment-under-total):not(.live-document__payment-in-totals):not(.live-document__payment-balance-banner)";

/**
 * Bake template colgroup widths into explicit px on every col/th/td.
 * html2canvas often ignores table-layout:fixed + % cols and resizes by
 * content — Item column then won't match the template preview.
 */
function lockExportTableColumnWidths(root: HTMLElement) {
  const table = root.querySelector(
    ".live-document__table",
  ) as HTMLElement | null;
  if (!table) return;

  table.style.tableLayout = "fixed";
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  const cols = Array.from(
    table.querySelectorAll("colgroup col"),
  ) as HTMLElement[];
  if (cols.length === 0) return;

  const tableWidth = table.getBoundingClientRect().width;
  if (tableWidth <= 0) return;

  const fracs = cols.map((col) => {
    const raw = (col.style.width || col.getAttribute("width") || "").trim();
    const pct = raw.match(/([\d.]+)\s*%/);
    if (pct) return Math.max(Number(pct[1]), 0);
    const px = raw.match(/([\d.]+)\s*px/);
    if (px) return Math.max(Number(px[1]), 0);
    return 0;
  });

  let sum = fracs.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    fracs.forEach((_, i) => {
      fracs[i] = 1;
    });
    sum = fracs.length;
  }

  const widths = fracs.map((f) => (f / sum) * tableWidth);

  const applyWidth = (el: HTMLElement, w: number) => {
    const px = Math.max(1, Math.round(w * 100) / 100);
    el.style.width = `${px}px`;
    el.style.minWidth = `${px}px`;
    el.style.maxWidth = `${px}px`;
    el.style.boxSizing = "border-box";
  };

  cols.forEach((col, i) => applyWidth(col, widths[i]!));

  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const cells = Array.from(row.children) as HTMLElement[];
    cells.forEach((cell, i) => {
      if (widths[i] == null) return;
      applyWidth(cell, widths[i]!);
      if (
        cell.classList.contains("live-document__cell--numeric") ||
        cell.classList.contains("live-document__cell--sku")
      ) {
        // Keep column width; nowrap lives on the inner align wrap only.
        cell.style.overflow = "hidden";
        cell.style.whiteSpace = cell.classList.contains(
          "live-document__cell--rate",
        )
          ? "normal"
          : "nowrap";
      }
    });
  }

  // Keep item rows at title+subtitle height with vertically centered text.
  for (const item of Array.from(
    root.querySelectorAll(".live-document__item-cell"),
  )) {
    const el = item as HTMLElement;
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.width = "100%";
    el.style.minWidth = "0";
    el.style.minHeight = "calc(1.4em + 0.25em + 0.9em * 1.4)";
  }
  for (const text of Array.from(
    root.querySelectorAll(".live-document__item-text"),
  )) {
    const el = text as HTMLElement;
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.justifyContent = "center";
    el.style.minWidth = "0";
    el.style.maxWidth = "100%";
  }
  for (const cell of Array.from(
    root.querySelectorAll(".live-document__table tbody td"),
  )) {
    (cell as HTMLElement).style.verticalAlign = "middle";
  }
}

/**
 * html2canvas often ignores `text-align:right` (and paints `<th>` as centered
 * from the UA stylesheet). Float is also unreliable. Use a full-width inner
 * block with explicit text-align / flex-end so Qty/Rate/Amount + totals share
 * one straight right edge matching the template preview.
 */
function hardenExportRightAlign(root: HTMLElement) {
  const cellPadRight = "0.55em";

  for (const cell of Array.from(
    root.querySelectorAll(
      "td.live-document__cell--numeric, th.live-document__cell--numeric",
    ),
  )) {
    const el = cell as HTMLElement;
    el.style.display = "table-cell";
    el.style.textAlign = "right";
    el.style.paddingLeft = "0.35em";
    el.style.paddingRight = cellPadRight;
    el.style.verticalAlign = el.tagName === "TH" ? "bottom" : "middle";
    el.style.fontVariantNumeric = "tabular-nums";
    if (!el.style.maxWidth) {
      el.style.whiteSpace = el.classList.contains("live-document__cell--rate")
        ? "normal"
        : "nowrap";
    }

    let wrap = el.querySelector(
      ":scope > [data-pdf-align]",
    ) as HTMLElement | null;
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.setAttribute("data-pdf-align", "end");
      while (el.firstChild) wrap.appendChild(el.firstChild);
      el.appendChild(wrap);
    }

    const hasRate = Boolean(wrap.querySelector(".live-document__rate-cell"));
    // Full-width block — more reliable than float:right in html2canvas.
    wrap.style.cssText = "";
    wrap.setAttribute("data-pdf-align", "end");
    wrap.style.display = hasRate ? "flex" : "block";
    wrap.style.boxSizing = "border-box";
    wrap.style.width = "100%";
    wrap.style.maxWidth = "100%";
    wrap.style.margin = "0";
    wrap.style.padding = "0";
    wrap.style.float = "none";
    wrap.style.textAlign = "right";
    wrap.style.fontVariantNumeric = "tabular-nums";
    if (hasRate) {
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "flex-end";
      wrap.style.justifyContent = "center";
      wrap.style.whiteSpace = "normal";
    } else {
      wrap.style.whiteSpace = "nowrap";
    }
  }

  for (const rate of Array.from(
    root.querySelectorAll(".live-document__rate-cell"),
  )) {
    const el = rate as HTMLElement;
    el.style.width = "100%";
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.alignItems = "flex-end";
    el.style.textAlign = "right";
  }

  const totals = root.querySelector(
    ".live-document__totals",
  ) as HTMLElement | null;
  if (totals) {
    totals.style.width = "43%";
    totals.style.maxWidth = "43%";
    totals.style.marginLeft = "auto";
    totals.style.marginRight = "0";
    totals.style.boxSizing = "border-box";
  }

  const rows = Array.from(
    root.querySelectorAll(`.live-document__totals > div${TOTALS_ROW_EXCLUSION}`),
  ) as HTMLElement[];

  const valueNodes: HTMLElement[] = [];
  for (const row of rows) {
    const kids = Array.from(row.children) as HTMLElement[];
    if (kids.length < 2) continue;
    valueNodes.push(kids[kids.length - 1]!);
  }

  let maxValueWidth = 0;
  for (const value of valueNodes) {
    // Measure after clearing flex basis so natural width is accurate.
    value.style.flex = "0 0 auto";
    value.style.width = "auto";
    value.style.minWidth = "0";
    value.style.maxWidth = "none";
    maxValueWidth = Math.max(
      maxValueWidth,
      Math.ceil(value.getBoundingClientRect().width),
    );
  }
  // Fit the longest totals value (e.g. $111.215,29) with a little slack.
  maxValueWidth = Math.max(maxValueWidth, 56);

  for (const row of rows) {
    const kids = Array.from(row.children) as HTMLElement[];
    if (kids.length < 2) continue;
    const label = kids[0]!;
    const value = kids[kids.length - 1]!;

    row.style.display = "flex";
    row.style.flexDirection = "row";
    row.style.justifyContent = "flex-end";
    row.style.alignItems = "baseline";
    row.style.gap = "2.75em";
    row.style.width = "100%";
    row.style.boxSizing = "border-box";
    // Match Amount column padding so totals values share the table right edge.
    row.style.paddingLeft = "0.65em";
    row.style.paddingRight = cellPadRight;
    row.style.gridTemplateColumns = "none";

    label.style.flex = "1 1 auto";
    label.style.textAlign = "right";
    label.style.minWidth = "0";

    value.style.display = "block";
    value.style.flex = `0 0 ${maxValueWidth}px`;
    value.style.width = `${maxValueWidth}px`;
    value.style.minWidth = `${maxValueWidth}px`;
    value.style.maxWidth = `${maxValueWidth}px`;
    value.style.textAlign = "right";
    value.style.whiteSpace = "nowrap";
    value.style.fontVariantNumeric = "tabular-nums";
    value.style.boxSizing = "border-box";
    value.style.margin = "0";
    value.style.padding = "0";

    let valueWrap = value.querySelector(
      ":scope > [data-pdf-align='value']",
    ) as HTMLElement | null;
    if (!valueWrap) {
      valueWrap = document.createElement("span");
      valueWrap.setAttribute("data-pdf-align", "value");
      while (value.firstChild) valueWrap.appendChild(value.firstChild);
      value.appendChild(valueWrap);
    }
    // Full-width + text-align (not float) — same right edge every row.
    valueWrap.style.display = "block";
    valueWrap.style.width = "100%";
    valueWrap.style.float = "none";
    valueWrap.style.textAlign = "right";
    valueWrap.style.whiteSpace = "nowrap";
    valueWrap.style.fontVariantNumeric = "tabular-nums";
  }
}

/**
 * Keep-together units for PDF slicing. Prefer small leaf blocks (rows) so
 * pages fill down to the Bottom margin instead of jumping early when a large
 * parent (e.g. entire totals section) would not fit.
 *
 * Bordered payment chrome is listed separately and always re-added after leaf
 * filtering so dashed/solid boxes never split across pages.
 */
const PDF_KEEP_TOGETHER_SELECTORS = [
  ".live-document__totals > div",
  ".live-document__payment-row",
  ".live-document__payment-panel",
  ".live-document__tax-summary-table thead",
  ".live-document__tax-summary-table tbody tr",
  ".live-document__notes",
  ".live-document__terms",
  ".live-document__signature",
  ".live-document__stamp",
  ".live-document__table thead",
  ".live-document__table tbody tr",
  ".live-document__header",
  ".live-document__address-blocks",
  ".live-document__metadata",
  ".live-document__grand-total",
];

/** Bordered / multi-cell blocks that must never be sliced mid-box. */
const PDF_ATOMIC_BOX_SELECTORS = [
  ".live-document__payment-status",
  ".live-document__payment-split-panels",
  ".live-document__payment-balance-banner",
  ".live-document__payment-under-total",
  ".live-document__payment-in-totals",
  ".live-document__tax-summary",
  ".live-document__notes",
  ".live-document__terms",
];

type KeepRange = { top: number; bottom: number };

/** Drop parent ranges that fully contain a smaller keep range. */
function preferLeafKeepRanges(ranges: KeepRange[]): KeepRange[] {
  return ranges.filter((range, index) => {
    const containsSmaller = ranges.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      const otherH = other.bottom - other.top;
      const rangeH = range.bottom - range.top;
      if (otherH >= rangeH - 0.5) return false;
      return (
        other.top >= range.top - 0.5 && other.bottom <= range.bottom + 0.5
      );
    });
    return !containsSmaller;
  });
}

function pushKeepRange(
  ranges: KeepRange[],
  rootRect: DOMRect,
  el: HTMLElement,
  padPx = 0,
) {
  const rect = el.getBoundingClientRect();
  const top = rect.top - rootRect.top - padPx;
  const bottom = rect.bottom - rootRect.top + padPx;
  if (bottom - top < 0.5) return;
  ranges.push({
    top: Math.max(0, top),
    bottom,
  });
}

function collectPdfKeepTogetherRanges(root: HTMLElement): KeepRange[] {
  const rootRect = root.getBoundingClientRect();
  const ranges: KeepRange[] = [];

  for (const selector of PDF_KEEP_TOGETHER_SELECTORS) {
    for (const node of Array.from(root.querySelectorAll(selector))) {
      pushKeepRange(ranges, rootRect, node as HTMLElement);
    }
  }

  ranges.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  const leaf = preferLeafKeepRanges(ranges);

  // Atomic bordered chrome — always keep whole box (survives leaf filter).
  // Do NOT cluster Total with Paid Amount: if Total fits on this page it
  // stays; only the payment box moves when it would be sliced.
  for (const selector of PDF_ATOMIC_BOX_SELECTORS) {
    for (const node of Array.from(root.querySelectorAll(selector))) {
      pushKeepRange(leaf, rootRect, node as HTMLElement, 1);
    }
  }

  leaf.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  return leaf;
}

/**
 * Pick page cut points so keep-together blocks are not sliced.
 * Cuts at the usable page height unless a keep-together block would split —
 * then pull the break up to that block (never slice bordered boxes).
 * Rows that fully fit above the cut stay on the current page.
 * `keepRanges` are in the same coordinate space as `contentHeightPx`.
 */
function computeHtmlPdfPageBreaks(
  contentHeightPx: number,
  pageHeightPx: number,
  keepRanges: KeepRange[],
): number[] {
  const total = Math.max(1, Math.ceil(contentHeightPx));
  const pageH = Math.max(1, pageHeightPx);
  const ranges = keepRanges.filter((range) => range.bottom > range.top + 0.5);

  const breaks = [0];
  let y = 0;
  let guard = 0;

  while (y < total - 0.5 && guard < 200) {
    guard += 1;
    const ideal = Math.min(y + pageH, total);
    if (ideal >= total - 0.5) {
      breaks.push(total);
      break;
    }

    let cut = ideal;

    // Move the break to the start of the earliest block that does not fully
    // fit before `ideal`. Blocks that fit (e.g. Total) stay on this page;
    // only the overflowing box (e.g. Paid Amount) is pushed.
    let earliestSplitTop: number | null = null;
    for (const range of ranges) {
      if (range.bottom <= ideal + 0.35) continue; // fits entirely
      if (range.top >= ideal - 0.35) continue; // already on next page
      // Would be sliced by the ideal cut (starts on this page, ends past it).
      const blockHeight = range.bottom - range.top;
      if (blockHeight > pageH * 0.98 && range.top <= y + 0.35) {
        // Oversized block that began at the page start — cannot avoid slice.
        continue;
      }
      if (range.top <= y + 2) continue; // would cause a zero-advance loop
      if (earliestSplitTop === null || range.top < earliestSplitTop) {
        earliestSplitTop = range.top;
      }
    }

    if (earliestSplitTop !== null && earliestSplitTop > y + 0.5) {
      cut = earliestSplitTop;
    }

    // Avoid zero-length / tiny advances that loop forever.
    if (cut <= y + 2) {
      cut = ideal;
    }

    const nextY = Math.min(total, Math.max(y + 2, Math.floor(cut)));
    breaks.push(nextY);
    y = nextY;
  }

  if (breaks[breaks.length - 1]! < total) {
    breaks.push(total);
  }

  return breaks;
}

function sliceCanvasVertical(
  source: HTMLCanvasElement,
  startY: number,
  endY: number,
) {
  const sy = Math.max(0, Math.floor(startY));
  const ey = Math.min(source.height, Math.ceil(endY));
  const height = Math.max(1, ey - sy);
  const slice = document.createElement("canvas");
  slice.width = source.width;
  slice.height = height;
  const ctx = slice.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(
    source,
    0,
    sy,
    source.width,
    height,
    0,
    0,
    source.width,
    height,
  );
  return slice;
}

/**
 * Renders the on-screen template paper into a PDF (same font/layout as templates).
 */
export async function buildSalesOrderTemplatePdfFromElement(
  paper: HTMLElement,
  settings: TemplateExportSettings,
) {
  const html2canvas = await loadHtml2Canvas();
  const size = paperSizeMm(settings.paperSize, settings.orientation);
  const widthPx = Math.round(size.width * PX_PER_MM);

  const host = document.createElement("div");
  host.setAttribute("data-sales-order-export", "true");
  // Keep in viewport (opacity 0) so fonts/layout paint reliably for html2canvas.
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${widthPx}px`,
    "margin:0",
    "padding:0",
    "opacity:0",
    "background:transparent",
    "pointer-events:none",
    "overflow:hidden",
    "z-index:-1",
  ].join(";");

  const clone = paper.cloneNode(true) as HTMLElement;
  clone.classList.add("is-print-export");
  // Admin-only ribbons / chrome must not affect layout or appear in the PDF.
  for (const el of Array.from(clone.querySelectorAll(".no-print"))) {
    el.remove();
  }
  clone.style.width = `${widthPx}px`;
  clone.style.maxWidth = `${widthPx}px`;
  clone.style.minHeight = "0";
  clone.style.height = "auto";
  clone.style.aspectRatio = "auto";
  clone.style.overflow = "visible";
  clone.style.boxShadow = "none";
  clone.style.border = "none";
  clone.style.margin = "0";
  clone.style.backgroundColor = settings.backgroundColor || "#ffffff";
  clone.style.fontFamily = settings.fontFamily;
  // Horizontal padding stays in the capture; vertical margins are applied per
  // PDF page so page 2+ also respect Top/Bottom from General settings.
  const marginMm = {
    top: Math.max(0, Number(settings.margins.top) || 0) * 10,
    right: Math.max(0, Number(settings.margins.right) || 0) * 10,
    bottom: Math.max(0, Number(settings.margins.bottom) || 0) * 10,
    left: Math.max(0, Number(settings.margins.left) || 0) * 10,
  };
  clone.style.padding = `0 ${marginMm.right}mm 0 ${marginMm.left}mm`;
  clone.style.containerType = "inline-size";
  clone.style.boxSizing = "border-box";
  // Force print colors (table header bg, total highlight, metadata box).
  clone.style.setProperty("-webkit-print-color-adjust", "exact");
  clone.style.setProperty("print-color-adjust", "exact");
  clone.style.setProperty("color-adjust", "exact");

  const live = clone.querySelector(".live-document") as HTMLElement | null;
  const sourceLive = paper.querySelector(".live-document") as HTMLElement | null;
  if (live) {
    live.style.minHeight = "0";
    // Prefer the on-screen computed size so PDF columns match the preview.
    const sourceFont =
      sourceLive != null ? getComputedStyle(sourceLive).fontSize : "";
    if (sourceFont) {
      live.style.fontSize = sourceFont;
    } else {
      const fontPx = Math.min(12.5, Math.max(9, widthPx * 0.0205));
      live.style.fontSize = `${fontPx}px`;
    }
    live.style.lineHeight = "1.45";
    live.style.setProperty("-webkit-print-color-adjust", "exact");
    live.style.setProperty("print-color-adjust", "exact");
  }

  // Keep logo sizing from source; ensure images aren't clipped.
  for (const img of Array.from(clone.querySelectorAll("img"))) {
    img.style.maxWidth = img.style.maxWidth || "46%";
    img.loading = "eager";
  }

  host.appendChild(clone);
  document.body.appendChild(host);

  // Wait for images inside the clone (logo data URLs usually already complete).
  await Promise.all(
    Array.from(clone.querySelectorAll("img")).map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );
  // Allow layout/fonts to settle after clone is in the document.
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font loading failures — fall back to system fonts.
    }
  }

  // html2canvas mishandles table % widths + text-align:right — lock after layout.
  lockExportTableColumnWidths(clone);
  hardenExportRightAlign(clone);

  try {
    const canvas = await html2canvas(clone, {
      scale: CAPTURE_SCALE,
      useCORS: true,
      allowTaint: true,
      backgroundColor: settings.backgroundColor || "#ffffff",
      logging: false,
      width: widthPx,
      windowWidth: widthPx,
      scrollX: 0,
      scrollY: 0,
      onclone: (_doc, el) => {
        el.style.width = `${widthPx}px`;
        el.style.maxWidth = `${widthPx}px`;
        el.style.padding = `0 ${marginMm.right}mm 0 ${marginMm.left}mm`;
        // Re-lock + re-harden inside html2canvas's clone document so
        // Qty/Rate/Amount headers and values keep preview right-align.
        lockExportTableColumnWidths(el);
        hardenExportRightAlign(el);
      },
    });

    const JsPDF = await loadJsPdf();
    const pdf = new JsPDF({
      orientation: settings.orientation === "landscape" ? "l" : "p",
      unit: "mm",
      format: jsPdfFormat(settings.paperSize),
      compress: true,
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;

    // Page breaks use the printable area inside Top/Bottom margins.
    // Content may fill from Top margin down to Bottom margin; only then
    // does the next page start.
    const usableHeightMm = Math.max(
      40,
      pageHeight - marginMm.top - marginMm.bottom,
    );
    // Canvas px ↔ PDF mm: full canvas width maps to full page width.
    const usablePagePx = (usableHeightMm / imgWidth) * canvas.width;
    // DOM → canvas scale for keep-together boxes (may differ slightly from
    // CAPTURE_SCALE if the browser rounds mm widths).
    const cssWidth = Math.max(1, clone.getBoundingClientRect().width || widthPx);
    const scale = canvas.width / cssWidth;

    // Map DOM keep-together boxes into canvas pixel space.
    const keepRanges = collectPdfKeepTogetherRanges(clone).map((range) => ({
      // Pad slightly so antialiased text at the edge isn't clipped.
      top: Math.max(0, (range.top - 2) * scale),
      bottom: Math.min(canvas.height, (range.bottom + 2) * scale),
    }));
    const breaks = computeHtmlPdfPageBreaks(
      canvas.height,
      usablePagePx,
      keepRanges,
    );

    for (let i = 0; i < breaks.length - 1; i += 1) {
      const startY = breaks[i];
      const endY = breaks[i + 1];
      if (endY - startY < 1) continue;

      // Never draw past the Bottom margin line.
      const maxSlicePx = Math.min(endY, startY + usablePagePx);
      const slice = sliceCanvasVertical(canvas, startY, maxSlicePx);
      const sliceHeightMm = Math.min(
        usableHeightMm,
        (slice.height * imgWidth) / canvas.width,
      );
      const imgData = slice.toDataURL("image/jpeg", 0.95);

      if (i > 0) pdf.addPage();
      // White page + place content below the Top margin.
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");
      pdf.addImage(
        imgData,
        "JPEG",
        0,
        marginMm.top,
        imgWidth,
        sliceHeightMm,
        undefined,
        "MEDIUM",
      );
    }

    return pdf;
  } finally {
    host.remove();
  }
}

export async function downloadSalesOrderHtmlPdf(
  paper: HTMLElement,
  settings: TemplateExportSettings,
  orderName: string,
  documentKind: "sales-order" | "invoice" = "sales-order",
) {
  const pdf = await buildSalesOrderTemplatePdfFromElement(paper, settings);
  pdf.save(salesOrderPdfFileName(orderName, documentKind));
}

let cssColorProbeCtx: CanvasRenderingContext2D | null | undefined;

function parseCssChannel(raw: string, max = 255): number {
  const t = raw.trim();
  if (t.endsWith("%")) {
    return Math.round((parseFloat(t) / 100) * max);
  }
  return Math.round(Number(t));
}

function parseCssAlpha(raw: string | undefined): number {
  if (raw == null || raw === "") return 1;
  const t = raw.trim();
  if (t.endsWith("%")) return Math.max(0, Math.min(1, parseFloat(t) / 100));
  const n = Number(t);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

/**
 * Parse CSS color → RGB. Returns null for transparent / invalid.
 * Supports hex, legacy rgb(), modern space-separated rgb(), and canvas fallback
 * (oklch / color-mix resolved forms from getComputedStyle).
 */
function parseCssRgb(
  value: string,
): [number, number, number] | null {
  const v = value.trim();
  if (!v) return null;
  const lower = v.toLowerCase();
  if (
    lower === "transparent" ||
    lower === "rgba(0, 0, 0, 0)" ||
    lower === "rgba(0,0,0,0)" ||
    lower === "rgb(0 0 0 / 0)" ||
    lower === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0]! + h[0]!, 16);
      const g = parseInt(h[1]! + h[1]!, 16);
      const b = parseInt(h[2]! + h[2]!, 16);
      const a = h.length === 4 ? parseInt(h[3]! + h[3]!, 16) / 255 : 1;
      if (a < 0.08) return null;
      return [r, g, b];
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    if (a < 0.08) return null;
    return [r, g, b];
  }

  // Legacy: rgb(r, g, b) / rgba(r, g, b, a)
  const legacy =
    /^rgba?\(\s*([\d.]+%?)\s*,\s*([\d.]+%?)\s*,\s*([\d.]+%?)(?:\s*,\s*([\d.]+%?))?\s*\)$/i.exec(
      v,
    );
  if (legacy) {
    const a = parseCssAlpha(legacy[4]);
    if (a < 0.08) return null;
    return [
      parseCssChannel(legacy[1]!),
      parseCssChannel(legacy[2]!),
      parseCssChannel(legacy[3]!),
    ];
  }

  // Modern: rgb(r g b / a) — Chromium getComputedStyle default
  const modern =
    /^rgba?\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i.exec(
      v,
    );
  if (modern) {
    const a = parseCssAlpha(modern[4]);
    if (a < 0.08) return null;
    return [
      parseCssChannel(modern[1]!),
      parseCssChannel(modern[2]!),
      parseCssChannel(modern[3]!),
    ];
  }

  // Canvas round-trip for named colors / oklch / leftover forms.
  if (typeof document !== "undefined") {
    if (cssColorProbeCtx === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      cssColorProbeCtx = canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = cssColorProbeCtx;
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      // Sentinel so invalid assignments don't silently paint black.
      ctx.fillStyle = "rgba(1, 2, 3, 1)";
      try {
        ctx.fillStyle = v;
      } catch {
        return null;
      }
      const applied = String(ctx.fillStyle).toLowerCase();
      if (
        applied === "#010203" ||
        applied === "rgb(1, 2, 3)" ||
        applied === "rgba(1, 2, 3, 1)"
      ) {
        const looksLikeSentinel =
          lower === "#010203" ||
          lower.includes("1, 2, 3") ||
          lower.includes("1 2 3");
        if (!looksLikeSentinel) return null;
      }
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      if (data[3]! < 20) return null;
      return [data[0]!, data[1]!, data[2]!];
    }
  }

  return null;
}

function applyTextTransform(text: string, transform: string): string {
  switch (transform) {
    case "uppercase":
      return text.toLocaleUpperCase();
    case "lowercase":
      return text.toLocaleLowerCase();
    case "capitalize":
      return text.replace(/\b\w/g, (ch) => ch.toLocaleUpperCase());
    default:
      return text;
  }
}

function blendRgb(
  fg: [number, number, number],
  bg: [number, number, number],
  opacity: number,
): [number, number, number] {
  const o = Math.max(0, Math.min(1, opacity));
  return [
    Math.round(fg[0] * o + bg[0] * (1 - o)),
    Math.round(fg[1] * o + bg[1] * (1 - o)),
    Math.round(fg[2] * o + bg[2] * (1 - o)),
  ];
}

function borderDashPattern(
  borderStyle: string,
  widthPx: number,
  pxToMm: number,
): number[] | undefined {
  const w = Math.max(0.15, widthPx * pxToMm);
  if (borderStyle === "dashed") {
    return [Math.max(0.7, w * 3), Math.max(0.45, w * 2)];
  }
  if (borderStyle === "dotted") {
    return [Math.max(0.2, w * 0.9), Math.max(0.35, w * 1.4)];
  }
  return undefined;
}

type DomVectorOp =
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: [number, number, number];
      stroke?: [number, number, number];
      lineWidth?: number;
      /** Corner radius in mm (matches CSS border-radius). */
      radius?: number;
      /** Soft drop shadow under the box (metadata card). */
      shadow?: {
        color: [number, number, number];
        blurMm: number;
        offsetXMm: number;
        offsetYMm: number;
      };
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: [number, number, number];
      lineWidth: number;
      dash?: number[];
    }
  | {
      kind: "text";
      text: string;
      x: number;
      y: number;
      w: number;
      fontPt: number;
      bold: boolean;
      color: [number, number, number];
      align: "left" | "center" | "right";
      strike?: boolean;
      /** jsPDF charSpace in mm (from CSS letter-spacing). */
      charSpaceMm?: number;
    }
  | {
      kind: "image";
      dataUrl: string;
      format: "PNG" | "JPEG";
      x: number;
      y: number;
      w: number;
      h: number;
    };

/**
 * Measure the on-screen template DOM and emit vector draw ops in mm.
 * Layout matches Template Preview 1:1; text stays selectable/sharp.
 */
function collectDomVectorOps(
  root: HTMLElement,
  pageWidthMm: number,
): { ops: DomVectorOp[]; contentHeightMm: number } {
  const rootRect = root.getBoundingClientRect();
  const cssW = Math.max(1, rootRect.width);
  const pxToMm = pageWidthMm / cssW;
  const ops: DomVectorOp[] = [];

  const toX = (px: number) => (px - rootRect.left) * pxToMm;
  const toY = (px: number) => (px - rootRect.top) * pxToMm;

  const isInvisible = (style: CSSStyleDeclaration) =>
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0;

  const cumulativeOpacity = (el: HTMLElement) => {
    let opacity = 1;
    let node: HTMLElement | null = el;
    while (node && node !== root.parentElement) {
      const op = Number(getComputedStyle(node).opacity);
      if (Number.isFinite(op)) opacity *= op;
      if (node === root) break;
      node = node.parentElement;
    }
    return opacity;
  };

  /** Resolve effective horizontal alignment for a text-bearing element. */
  const resolveAlign = (
    el: HTMLElement,
  ): "left" | "center" | "right" => {
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      if (
        node.classList.contains("live-document__cell--numeric") ||
        node.classList.contains("live-document__rate-cell") ||
        node.classList.contains("live-document__rate-value")
      ) {
        return "right";
      }
      const style = getComputedStyle(node);
      const align = style.textAlign;
      if (align === "right" || align === "end") return "right";
      if (align === "center") return "center";
      // Totals value column (last child) is always right-aligned in preview.
      const parentEl = node.parentElement;
      if (
        parentEl &&
        (parentEl.classList.contains("live-document__totals") ||
          parentEl.classList.contains("live-document__payment-row"))
      ) {
        const kids = Array.from(parentEl.children) as Element[];
        if (kids[kids.length - 1] === node) return "right";
      }
      node = node.parentElement;
    }
    return "left";
  };

  const pushTextOp = (
    text: string,
    r: DOMRect,
    fontPt: number,
    bold: boolean,
    color: [number, number, number],
    align: "left" | "center" | "right",
    strike: boolean,
    forceRightXMm?: number | null,
    charSpaceMm?: number,
  ) => {
    // Pin to the browser glyph box edge so NotoSans width ≠ Inter still
    // keeps Amount / totals values on one straight right column.
    let x =
      align === "right"
        ? toX(r.right)
        : align === "center"
          ? toX(r.left + r.width / 2)
          : toX(r.left);
    let outAlign = align;
    if (forceRightXMm != null && align === "right") {
      x = forceRightXMm;
      outAlign = "right";
    }
    const y = toY(r.top) + r.height * pxToMm * 0.78;
    ops.push({
      kind: "text",
      text,
      x,
      y,
      w: r.width * pxToMm,
      fontPt,
      bold,
      color,
      align: outAlign,
      strike,
      charSpaceMm:
        charSpaceMm && Math.abs(charSpaceMm) > 0.001 ? charSpaceMm : undefined,
    });
  };

  const resolveTextPaint = (el: HTMLElement, style: CSSStyleDeclaration) => {
    let bgBlend: [number, number, number] = [255, 255, 255];
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      const bg = parseCssRgb(getComputedStyle(node).backgroundColor);
      if (bg) {
        bgBlend = bg;
        break;
      }
      node = node.parentElement;
    }
    const base = parseCssRgb(style.color) ?? ([48, 48, 48] as [
      number,
      number,
      number,
    ]);
    const opacity = cumulativeOpacity(el);
    const color =
      opacity < 0.99 ? blendRgb(base, bgBlend, opacity) : base;
    const fontPx = parseFloat(style.fontSize) || 12;
    const fontPt = Math.max(5, fontPx * (72 / 96));
    const weight = parseInt(style.fontWeight, 10);
    const bold =
      style.fontWeight === "bold" ||
      style.fontWeight === "bolder" ||
      (Number.isFinite(weight) && weight >= 600);
    const letterPx = parseFloat(style.letterSpacing);
    const charSpaceMm =
      Number.isFinite(letterPx) && letterPx !== 0 ? letterPx * pxToMm : 0;
    return {
      color,
      fontPt,
      bold,
      transform: style.textTransform || "none",
      charSpaceMm,
    };
  };

  // Amount column content-right — snap totals values to this edge.
  let amountRightMm: number | null = null;
  const amountSample = root.querySelector(
    ".live-document__table tbody tr td:last-child, .live-document__table thead tr th:last-child",
  ) as HTMLElement | null;
  if (amountSample) {
    const pad = parseFloat(getComputedStyle(amountSample).paddingRight) || 0;
    amountRightMm = toX(amountSample.getBoundingClientRect().right - pad);
  }

  const isTotalsValueEl = (el: HTMLElement) => {
    // Never treat labels / row wrappers as values (caused Balance Due overlap).
    if (el.classList.contains("live-document__payment-status-label")) {
      return false;
    }
    if (el.classList.contains("live-document__payment-row")) return false;
    if (el.classList.contains("live-document__payment-in-totals")) return false;
    if (el.classList.contains("live-document__payment-split-panels")) {
      return false;
    }
    if (el.classList.contains("live-document__payment-status-value")) {
      return true;
    }
    if (el.getAttribute("data-pdf-align") === "value") return true;
    if (el.closest("[data-pdf-align='value']") != null) return true;

    const row = el.parentElement;
    if (!row) return false;

    // Value cell inside a payment row.
    if (row.classList.contains("live-document__payment-row")) {
      const kids = Array.from(row.children) as Element[];
      return kids[kids.length - 1] === el;
    }

    // Direct totals row: <div><span>Label</span><span>Value</span></div>
    // or grand-total with <strong> children — skip payment wrappers.
    if (
      row.parentElement?.classList.contains("live-document__totals") &&
      !row.classList.contains("live-document__payment-in-totals") &&
      !row.classList.contains("live-document__payment-under-total") &&
      !row.classList.contains("live-document__payment-split-panels") &&
      !row.classList.contains("live-document__payment-balance-banner")
    ) {
      const kids = Array.from(row.children) as Element[];
      return kids.length >= 2 && kids[kids.length - 1] === el;
    }

    return false;
  };

  // Backgrounds + borders (table header, totals bar, metadata, row lines).
  for (const node of Array.from(root.querySelectorAll("*"))) {
    const el = node as HTMLElement;
    const style = getComputedStyle(el);
    if (isInvisible(style)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) continue;

    const x = toX(rect.left);
    const y = toY(rect.top);
    const w = rect.width * pxToMm;
    const h = rect.height * pxToMm;
    const isMetadata = el.classList.contains("live-document__metadata");
    const radiusPx = Math.max(
      parseFloat(style.borderTopLeftRadius) || 0,
      parseFloat(style.borderTopRightRadius) || 0,
      parseFloat(style.borderBottomRightRadius) || 0,
      parseFloat(style.borderBottomLeftRadius) || 0,
      parseFloat(style.borderRadius) || 0,
    );
    const radiusMm =
      radiusPx > 0.5 ? Math.min(radiusPx * pxToMm, Math.min(w, h) / 2) : 0;

    const bgRaw = parseCssRgb(style.backgroundColor);
    const elOpacity = cumulativeOpacity(el);
    const bg =
      bgRaw && elOpacity < 0.99
        ? blendRgb(bgRaw, [255, 255, 255], elOpacity)
        : bgRaw;
    // Full box borders (metadata card/outline, panels) — not only bottom rules.
    const borderTopW = parseFloat(style.borderTopWidth) || 0;
    const borderRightW = parseFloat(style.borderRightWidth) || 0;
    const borderBottomW = parseFloat(style.borderBottomWidth) || 0;
    const borderLeftW = parseFloat(style.borderLeftWidth) || 0;
    const borderTopStyle = style.borderTopStyle;
    const borderRightStyle = style.borderRightStyle;
    const borderBottomStyle = style.borderBottomStyle;
    const borderLeftStyle = style.borderLeftStyle;
    const borderTop =
      borderTopStyle !== "none" && borderTopW > 0
        ? parseCssRgb(style.borderTopColor)
        : null;
    const borderRight =
      borderRightStyle !== "none" && borderRightW > 0
        ? parseCssRgb(style.borderRightColor)
        : null;
    const borderBottom =
      borderBottomStyle !== "none" && borderBottomW > 0
        ? parseCssRgb(style.borderBottomColor)
        : null;
    const borderLeft =
      borderLeftStyle !== "none" && borderLeftW > 0
        ? parseCssRgb(style.borderLeftColor)
        : null;

    const hasFullBox = Boolean(
      borderTop &&
        borderRight &&
        borderBottom &&
        borderLeft &&
        Math.abs(borderTopW - borderRightW) < 0.25 &&
        Math.abs(borderTopW - borderBottomW) < 0.25 &&
        Math.abs(borderTopW - borderLeftW) < 0.25,
    );
    const anyDashedBorder = [borderTopStyle, borderRightStyle, borderBottomStyle, borderLeftStyle].some(
      (s) => s === "dashed" || s === "dotted",
    );

    // Keep white fills when the box has a visible border (metadata card).
    if (bg) {
      const isNearWhite = bg[0] > 250 && bg[1] > 250 && bg[2] > 250;
      if (!isNearWhite || hasFullBox || isMetadata) {
        let shadow:
          | {
              color: [number, number, number];
              blurMm: number;
              offsetXMm: number;
              offsetYMm: number;
            }
          | undefined;
        if (style.boxShadow && style.boxShadow !== "none") {
          // Soft card / panel shadow (preview: 0 1px 3px rgb(0 0 0 / 6%))
          shadow = {
            color: [0, 0, 0],
            blurMm: Math.max(0.4, 3 * pxToMm),
            offsetXMm: 0,
            offsetYMm: Math.max(0.2, 1 * pxToMm),
          };
        }
        ops.push({
          kind: "rect",
          x,
          y,
          w,
          h,
          fill: bg,
          radius: radiusMm > 0 ? radiusMm : undefined,
          shadow,
        });
      }
    }

    if (hasFullBox && borderTop && !anyDashedBorder) {
      const lineWidth = Math.max(0.18, borderTopW * pxToMm);
      // Inset stroke so it sits on the CSS border box (not outside).
      const inset = lineWidth / 2;
      ops.push({
        kind: "rect",
        x: x + inset,
        y: y + inset,
        w: Math.max(0.2, w - lineWidth),
        h: Math.max(0.2, h - lineWidth),
        stroke: borderTop,
        lineWidth,
        radius:
          radiusMm > inset
            ? Math.max(0, radiusMm - inset)
            : radiusMm > 0
              ? radiusMm
              : undefined,
      });
    } else {
      if (borderTop) {
        const ly = toY(rect.top);
        ops.push({
          kind: "line",
          x1: x,
          y1: ly,
          x2: x + w,
          y2: ly,
          color: borderTop,
          lineWidth: Math.max(0.1, borderTopW * pxToMm),
          dash: borderDashPattern(borderTopStyle, borderTopW, pxToMm),
        });
      }
      if (borderRight) {
        const lx = toX(rect.right);
        ops.push({
          kind: "line",
          x1: lx,
          y1: y,
          x2: lx,
          y2: y + h,
          color: borderRight,
          lineWidth: Math.max(0.1, borderRightW * pxToMm),
          dash: borderDashPattern(borderRightStyle, borderRightW, pxToMm),
        });
      }
      if (borderBottom) {
        const ly = toY(rect.bottom);
        ops.push({
          kind: "line",
          x1: x,
          y1: ly,
          x2: x + w,
          y2: ly,
          color: borderBottom,
          lineWidth: Math.max(0.1, borderBottomW * pxToMm),
          dash: borderDashPattern(borderBottomStyle, borderBottomW, pxToMm),
        });
      }
      if (borderLeft) {
        const lx = toX(rect.left);
        ops.push({
          kind: "line",
          x1: lx,
          y1: y,
          x2: lx,
          y2: y + h,
          color: borderLeft,
          lineWidth: Math.max(0.1, borderLeftW * pxToMm),
          dash: borderDashPattern(borderLeftStyle, borderLeftW, pxToMm),
        });
      }
    }

    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      const embed = img.getAttribute("data-pdf-embed");
      const formatAttr = img.getAttribute("data-pdf-format");
      const src = embed || img.currentSrc || img.src;
      const ready =
        Boolean(embed) ||
        (img.naturalWidth > 0 && img.naturalHeight > 0 && Boolean(src));
      if (src && ready) {
        const format =
          formatAttr === "PNG" || formatAttr === "JPEG"
            ? formatAttr
            : detectImageFormat(src);
        ops.push({
          kind: "image",
          dataUrl: src,
          format,
          x,
          y,
          w,
          h,
        });
      }
    }

    // Paint ::before / ::after boxes (e.g. minimal title accent bar).
    for (const pseudo of ["::before", "::after"] as const) {
      const pStyle = getComputedStyle(el, pseudo);
      const content = pStyle.content;
      if (!content || content === "none") continue;
      if (isInvisible(pStyle)) continue;
      const pw = parseFloat(pStyle.width);
      const ph = parseFloat(pStyle.height);
      if (!(pw > 0.5) || !(ph > 0.5)) continue;
      const pBg = parseCssRgb(pStyle.backgroundColor);
      if (!pBg) continue;

      const mlRaw = pStyle.marginLeft;
      const mrRaw = pStyle.marginRight;
      const mlAuto = mlRaw === "auto";
      const mrAuto = mrRaw === "auto";
      const mlPx = mlAuto ? 0 : parseFloat(mlRaw) || 0;
      const mrPx = mrAuto ? 0 : parseFloat(mrRaw) || 0;
      const mtPx = parseFloat(pStyle.marginTop) || 0;
      const mbPx = parseFloat(pStyle.marginBottom) || 0;

      let leftPx: number;
      if (mlAuto && !mrAuto) {
        leftPx = rect.right - pw - mrPx;
      } else if (!mlAuto && mrAuto) {
        leftPx = rect.left + mlPx;
      } else if (mlAuto && mrAuto) {
        leftPx = rect.left + (rect.width - pw) / 2;
      } else {
        leftPx = rect.left + mlPx;
      }

      const topPx =
        pseudo === "::after"
          ? rect.bottom - ph - mbPx
          : rect.top + mtPx;

      const pRadiusPx = Math.max(
        parseFloat(pStyle.borderTopLeftRadius) || 0,
        parseFloat(pStyle.borderRadius) || 0,
      );
      const pW = pw * pxToMm;
      const pH = ph * pxToMm;
      const pRadiusMm =
        pRadiusPx > 0.5
          ? Math.min(pRadiusPx * pxToMm, Math.min(pW, pH) / 2)
          : 0;

      ops.push({
        kind: "rect",
        x: toX(leftPx),
        y: toY(topPx),
        w: pW,
        h: pH,
        fill: pBg,
        radius: pRadiusMm > 0 ? pRadiusMm : undefined,
      });
    }
  }

  // Vector text from DOM text nodes (preview positions / sizes / colors).
  // Totals values may contain "$" + amount as separate text nodes — emit once
  // as a single string so currency stays in front and doesn't overlap.
  const emittedValueEls = new WeakSet<HTMLElement>();
  const findTotalsValueContainer = (
    el: HTMLElement,
  ): HTMLElement | null => {
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      if (isTotalsValueEl(node)) return node;
      node = node.parentElement;
    }
    return null;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    const raw = textNode.nodeValue ?? "";
    const text = raw.replace(/\u00a0/g, " ");
    if (text.trim().length === 0) {
      textNode = walker.nextNode();
      continue;
    }

    const parent = textNode.parentElement;
    if (!parent) {
      textNode = walker.nextNode();
      continue;
    }
    const style = getComputedStyle(parent);
    if (isInvisible(style)) {
      textNode = walker.nextNode();
      continue;
    }

    const valueContainer = findTotalsValueContainer(parent);
    if (valueContainer) {
      if (emittedValueEls.has(valueContainer)) {
        textNode = walker.nextNode();
        continue;
      }
      emittedValueEls.add(valueContainer);

      const fullText = (valueContainer.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!fullText) {
        textNode = walker.nextNode();
        continue;
      }

      const valueStyle = getComputedStyle(valueContainer);
      const paint = resolveTextPaint(valueContainer, valueStyle);
      const fullPaintText = applyTextTransform(fullText, paint.transform);

      const isPaymentValue = valueContainer.classList.contains(
        "live-document__payment-status-value",
      );
      const inBoxedPayment =
        isPaymentValue &&
        valueContainer.closest(".live-document__payment-status") != null;
      const inSplitPanel =
        isPaymentValue &&
        valueContainer.closest(".live-document__payment-panel") != null;

      let rect = valueContainer.getBoundingClientRect();
      // Collapsed/zero-width value spans still have textContent — use parent box.
      if (rect.width <= 0.5 || rect.height <= 0.5) {
        const fallback = valueContainer.closest(
          ".live-document__payment-status-cell--value, .live-document__payment-row, .live-document__payment-panel, .live-document__grand-total, [data-pdf-align='value']",
        ) as HTMLElement | null;
        if (fallback) rect = fallback.getBoundingClientRect();
      }

      if (rect.width > 0.5 && rect.height > 0.5) {
        // Boxed payment grid is centered across the page — never snap those
        // values to the Amount column (both Paid + Balance landed on one X).
        const align: "left" | "center" | "right" = inBoxedPayment
          ? "center"
          : "right";
        const ownRightMm = toX(rect.right);
        const snapRight =
          !isPaymentValue &&
          amountRightMm != null &&
          Math.abs(ownRightMm - amountRightMm) < 10
            ? amountRightMm
            : isPaymentValue && !inBoxedPayment && !inSplitPanel
              ? // underTotal / inTotals: prefer Amount column when nearby
                amountRightMm != null &&
                Math.abs(ownRightMm - amountRightMm) < 10
                  ? amountRightMm
                  : null
              : null;

        pushTextOp(
          fullPaintText,
          rect,
          paint.fontPt,
          paint.bold,
          paint.color,
          align,
          false,
          snapRight,
          paint.charSpaceMm,
        );
      }

      textNode = walker.nextNode();
      continue;
    }

    const paint = resolveTextPaint(parent, style);
    const align = resolveAlign(parent);
    const strike =
      style.textDecorationLine.includes("line-through") ||
      style.textDecoration.includes("line-through");

    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rects = Array.from(range.getClientRects()).filter(
      (r) => r.width > 0.5 && r.height > 0.5,
    );

    if (rects.length === 0) {
      textNode = walker.nextNode();
      continue;
    }

    // Multi-line text node: draw each client rect as its own line segment.
    if (rects.length === 1) {
      pushTextOp(
        applyTextTransform(text.trimEnd(), paint.transform),
        rects[0]!,
        paint.fontPt,
        paint.bold,
        paint.color,
        align,
        strike,
        null,
        paint.charSpaceMm,
      );
    } else {
      // Approximate line split by whitespace across rect count.
      const words = text.trim().split(/\s+/);
      const lines: string[] = [];
      if (words.length <= rects.length) {
        const per = Math.max(1, Math.ceil(words.length / rects.length));
        for (let i = 0; i < rects.length; i += 1) {
          lines.push(words.slice(i * per, (i + 1) * per).join(" "));
        }
      } else {
        let idx = 0;
        for (let i = 0; i < rects.length; i += 1) {
          const remainingLines = rects.length - i;
          const remainingWords = words.length - idx;
          const take = Math.max(
            1,
            Math.ceil(remainingWords / remainingLines),
          );
          lines.push(words.slice(idx, idx + take).join(" "));
          idx += take;
        }
      }

      rects.forEach((r, i) => {
        const line = (lines[i] || "").trim();
        if (!line) return;
        pushTextOp(
          applyTextTransform(line, paint.transform),
          r,
          paint.fontPt,
          paint.bold,
          paint.color,
          align,
          strike,
          null,
          paint.charSpaceMm,
        );
      });
    }

    textNode = walker.nextNode();
  }

  const contentHeightMm = Math.max(
    root.scrollHeight,
    root.getBoundingClientRect().height,
  ) * pxToMm;

  // Paint order: rects/lines/images under text.
  ops.sort((a, b) => {
    const rank = (op: DomVectorOp) =>
      op.kind === "rect" ? 0 : op.kind === "line" ? 1 : op.kind === "image" ? 2 : 3;
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const ay = a.kind === "line" ? a.y1 : a.y;
    const by = b.kind === "line" ? b.y1 : b.y;
    return ay - by;
  });

  return { ops, contentHeightMm };
}

/**
 * Vector PDF from the live template paper — layout matches Template Preview,
 * text is real PDF vectors (sharp zoom, selectable).
 */
export async function buildSalesOrderDomVectorPdfFromElement(
  paper: HTMLElement,
  settings: TemplateExportSettings,
) {
  const fonts = await loadPdfFonts();
  await ensureDomMeasureFont();
  const size = paperSizeMm(settings.paperSize, settings.orientation);
  const widthPx = Math.round(size.width * PX_PER_MM);

  const marginMm = {
    top: Math.max(0, Number(settings.margins.top) || 0) * 10,
    right: Math.max(0, Number(settings.margins.right) || 0) * 10,
    bottom: Math.max(0, Number(settings.margins.bottom) || 0) * 10,
    left: Math.max(0, Number(settings.margins.left) || 0) * 10,
  };

  const host = document.createElement("div");
  host.setAttribute("data-sales-order-export", "true");
  host.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${widthPx}px`,
    "margin:0",
    "padding:0",
    "opacity:0",
    "background:transparent",
    "pointer-events:none",
    "overflow:hidden",
    "z-index:-1",
  ].join(";");

  const clone = paper.cloneNode(true) as HTMLElement;
  // Prefer preview-faithful styles (not html2canvas table hacks).
  clone.classList.add("is-vector-export");
  clone.classList.remove("is-print-export");
  // Admin-only ribbons / chrome must not affect layout or appear in the PDF.
  for (const el of Array.from(clone.querySelectorAll(".no-print"))) {
    el.remove();
  }
  clone.style.width = `${widthPx}px`;
  clone.style.maxWidth = `${widthPx}px`;
  clone.style.minHeight = "0";
  clone.style.height = "auto";
  clone.style.aspectRatio = "auto";
  clone.style.overflow = "visible";
  clone.style.boxShadow = "none";
  clone.style.border = "none";
  clone.style.margin = "0";
  clone.style.backgroundColor = settings.backgroundColor || "#ffffff";
  // Measure with the same face jsPDF embeds — keeps positions/design aligned.
  clone.style.fontFamily = `${PDF_FONT}, ${settings.fontFamily || "sans-serif"}`;
  // Horizontal margins in capture; Top/Bottom applied per PDF page.
  clone.style.padding = `0 ${marginMm.right}mm 0 ${marginMm.left}mm`;
  clone.style.containerType = "inline-size";
  clone.style.boxSizing = "border-box";
  clone.style.setProperty("-webkit-print-color-adjust", "exact");
  clone.style.setProperty("print-color-adjust", "exact");

  const live = clone.querySelector(".live-document") as HTMLElement | null;
  const sourceLive = paper.querySelector(".live-document") as HTMLElement | null;
  if (live) {
    live.style.minHeight = "0";
    live.style.fontFamily = `${PDF_FONT}, ${settings.fontFamily || "sans-serif"}`;
    // Keep preview's computed size at natural paper width (cqw), then reflow
    // under Noto Sans so vector text lands on the same boxes.
    const sourceFont =
      sourceLive != null ? getComputedStyle(sourceLive).fontSize : "";
    if (sourceFont) live.style.fontSize = sourceFont;
    live.style.lineHeight = "1.45";
    live.style.setProperty("-webkit-print-color-adjust", "exact");
    live.style.setProperty("print-color-adjust", "exact");
  }

  for (const img of Array.from(clone.querySelectorAll("img"))) {
    img.loading = "eager";
  }

  host.appendChild(clone);
  document.body.appendChild(host);

  await Promise.all(
    Array.from(clone.querySelectorAll("img")).map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true });
        img.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );
  if (document.fonts?.load) {
    try {
      await Promise.all([
        document.fonts.load(`400 12px ${PDF_FONT}`),
        document.fonts.load(`700 12px ${PDF_FONT}`),
      ]);
    } catch {
      // ignore
    }
  }
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }

  // Re-encode PNG/JPG logos (and line images) into jsPDF-safe data URLs.
  await prepareCloneImagesForPdf(clone);

  // Keep column widths identical to the on-screen template.
  lockExportTableColumnWidths(clone);

  try {
    const pageWidth = size.width;
    const pageHeight = size.height;
    const { ops, contentHeightMm } = collectDomVectorOps(clone, pageWidth);

    const JsPDF = await loadJsPdf();
    const pdf = new JsPDF({
      orientation: settings.orientation === "landscape" ? "l" : "p",
      unit: "mm",
      format: jsPdfFormat(settings.paperSize),
      compress: true,
    });
    registerPdfFonts(pdf, fonts);

    const usableHeightMm = Math.max(
      40,
      pageHeight - marginMm.top - marginMm.bottom,
    );

    const keepRanges = collectPdfKeepTogetherRanges(clone).map((range) => {
      const cssW = Math.max(1, clone.getBoundingClientRect().width);
      const pxToMm = pageWidth / cssW;
      return {
        top: Math.max(0, range.top * pxToMm - 0.3),
        bottom: range.bottom * pxToMm + 0.3,
      };
    });

    // Reuse page-break helper in mm space (same units as contentHeightMm).
    const breaks = computeHtmlPdfPageBreaks(
      contentHeightMm,
      usableHeightMm,
      keepRanges,
    );

    const drawOpsOnPage = (pageStartMm: number, pageEndMm: number) => {
      const [bgR, bgG, bgB] = hexToRgb(settings.backgroundColor || "#ffffff");
      pdf.setFillColor(bgR, bgG, bgB);
      pdf.rect(0, 0, pageWidth, pageHeight, "F");

      for (const op of ops) {
        if (op.kind === "rect") {
          // Never paint orphan bottoms of boxes that started on a prior page.
          if (op.y < pageStartMm - 0.15) continue;
          if (op.y + op.h < pageStartMm - 0.2 || op.y > pageEndMm + 0.2) {
            continue;
          }
          const y = marginMm.top + (op.y - pageStartMm);
          const rx = Math.max(0, op.radius ?? 0);
          const ry = rx;
          const drawRect = (mode: "F" | "S" | "FD") => {
            if (rx > 0.05) {
              pdf.roundedRect(op.x, y, op.w, op.h, rx, ry, mode);
            } else {
              pdf.rect(op.x, y, op.w, op.h, mode);
            }
          };
          if (op.shadow && op.fill) {
            // Approximate CSS box-shadow with a soft offset fill (vector-safe).
            const layers = 3;
            for (let i = layers; i >= 1; i -= 1) {
              const t = i / layers;
              const spread = op.shadow.blurMm * t * 0.55;
              const alpha = 0.045 * t;
              pdf.setFillColor(
                Math.round(
                  op.shadow.color[0] * alpha + 255 * (1 - alpha),
                ),
                Math.round(
                  op.shadow.color[1] * alpha + 255 * (1 - alpha),
                ),
                Math.round(
                  op.shadow.color[2] * alpha + 255 * (1 - alpha),
                ),
              );
              const sx = op.x + op.shadow.offsetXMm - spread * 0.15;
              const sy = y + op.shadow.offsetYMm + spread * 0.2;
              const sw = op.w + spread * 0.35;
              const sh = op.h + spread * 0.45;
              if (rx > 0.05) {
                pdf.roundedRect(sx, sy, sw, sh, rx, ry, "F");
              } else {
                pdf.rect(sx, sy, sw, sh, "F");
              }
            }
          }
          if (op.fill) {
            pdf.setFillColor(...op.fill);
            drawRect("F");
          }
          if (op.stroke) {
            pdf.setDrawColor(...op.stroke);
            pdf.setLineWidth(op.lineWidth ?? 0.2);
            pdf.setLineDashPattern([], 0);
            drawRect("S");
          }
        } else if (op.kind === "line") {
          const minY = Math.min(op.y1, op.y2);
          const maxY = Math.max(op.y1, op.y2);
          const isHorizontal = Math.abs(op.y1 - op.y2) < 0.05;

          // Orphan stubs from a box that started on the previous page.
          if (minY < pageStartMm - 0.15) continue;
          if (maxY < pageStartMm - 0.2 || minY > pageEndMm + 0.2) continue;

          // Clip vertical rules to the page so side borders don't spill.
          let drawY1 = op.y1;
          let drawY2 = op.y2;
          if (!isHorizontal) {
            drawY1 = Math.max(op.y1, pageStartMm);
            drawY2 = Math.min(op.y2, pageEndMm);
            if (drawY2 - drawY1 < 0.15) continue;
          }

          const y1 = marginMm.top + (drawY1 - pageStartMm);
          const y2 = marginMm.top + (drawY2 - pageStartMm);
          pdf.setDrawColor(...op.color);
          pdf.setLineWidth(op.lineWidth);
          if (op.dash && op.dash.length > 0) {
            pdf.setLineDashPattern(op.dash, 0);
          } else {
            pdf.setLineDashPattern([], 0);
          }
          pdf.line(op.x1, y1, op.x2, y2);
          pdf.setLineDashPattern([], 0);
        } else if (op.kind === "image") {
          if (op.y < pageStartMm - 0.15) continue;
          if (op.y + op.h < pageStartMm - 0.2 || op.y > pageEndMm + 0.2) {
            continue;
          }
          const y = marginMm.top + (op.y - pageStartMm);
          try {
            // compression + alias help jsPDF accept large PNG/JPEG logos
            pdf.addImage(
              op.dataUrl,
              op.format,
              op.x,
              y,
              op.w,
              op.h,
              undefined,
              "FAST",
            );
          } catch {
            try {
              // Fallback: opposite format label sometimes works for mislabeled data.
              const alt = op.format === "PNG" ? "JPEG" : "PNG";
              pdf.addImage(op.dataUrl, alt, op.x, y, op.w, op.h, undefined, "FAST");
            } catch {
              // Skip tainted / unsupported images.
            }
          }
        } else if (op.kind === "text") {
          if (op.y < pageStartMm - 1 || op.y > pageEndMm + 1) continue;
          const y = marginMm.top + (op.y - pageStartMm);
          pdf.setFont(PDF_FONT, op.bold ? "bold" : "normal");
          pdf.setFontSize(op.fontPt);
          pdf.setTextColor(...op.color);
          if (op.charSpaceMm) {
            pdf.setCharSpace(op.charSpaceMm);
          } else {
            pdf.setCharSpace(0);
          }
          pdf.text(op.text, op.x, y, { align: op.align });
          pdf.setCharSpace(0);
          if (op.strike) {
            const textW = pdf.getTextWidth(op.text);
            const x1 =
              op.align === "right"
                ? op.x - textW
                : op.align === "center"
                  ? op.x - textW / 2
                  : op.x;
            const strikeY = y - op.fontPt * PT_TO_MM * 0.35;
            pdf.setDrawColor(...op.color);
            pdf.setLineWidth(0.2);
            pdf.setLineDashPattern([], 0);
            pdf.line(x1, strikeY, x1 + textW, strikeY);
          }
        }
      }
    };

    for (let i = 0; i < breaks.length - 1; i += 1) {
      const start = breaks[i]!;
      const end = Math.min(breaks[i + 1]!, start + usableHeightMm);
      if (end - start < 0.2) continue;
      if (i > 0) {
        pdf.addPage();
        registerPdfFonts(pdf, fonts);
      }
      drawOpsOnPage(start, end);
    }

    return pdf;
  } finally {
    host.remove();
  }
}

export async function downloadSalesOrderDomVectorPdf(
  paper: HTMLElement,
  settings: TemplateExportSettings,
  orderName: string,
  documentKind: "sales-order" | "invoice" = "sales-order",
) {
  const pdf = await buildSalesOrderDomVectorPdfFromElement(paper, settings);
  pdf.save(salesOrderPdfFileName(orderName, documentKind));
}

export async function printSalesOrderDomVectorPdf(
  paper: HTMLElement,
  settings: TemplateExportSettings,
) {
  const pdf = await buildSalesOrderDomVectorPdfFromElement(paper, settings);
  pdf.autoPrint();
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;
  document.body.appendChild(frame);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        frame.remove();
      }, 60_000);
    };

    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("Print window unavailable");
        win.focus();
        win.print();
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    frame.onerror = () => {
      cleanup();
      reject(new Error("Failed to load PDF for printing"));
    };
  });
}

export async function printSalesOrderHtmlDocument(
  paper: HTMLElement,
  settings: TemplateExportSettings,
) {
  // Same PDF pipeline as download → print/download match the template identically.
  const pdf = await buildSalesOrderTemplatePdfFromElement(paper, settings);
  pdf.autoPrint();
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  frame.src = url;
  document.body.appendChild(frame);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        frame.remove();
      }, 60_000);
    };

    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("Print window unavailable");
        win.focus();
        win.print();
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    frame.onerror = () => {
      cleanup();
      reject(new Error("Failed to load PDF for printing"));
    };
  });
}

/** Vector PDF print — sharp text on zoom (same builder as download). */
export async function printSalesOrderVectorPdf(args: PdfArgs) {
  const pdf = await buildSalesOrderVectorPdf(args);
  pdf.autoPrint();
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);

  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = url;
  document.body.appendChild(frame);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        frame.remove();
      }, 60_000);
    };

    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("Print window unavailable");
        win.focus();
        win.print();
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    frame.onerror = () => {
      cleanup();
      reject(new Error("Failed to load PDF for printing"));
    };
  });
}
