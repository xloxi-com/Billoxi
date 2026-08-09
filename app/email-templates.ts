/** Email template settings (safe for client + server). */

export type EmailDocumentKind =
  | "sales-order"
  | "invoice"
  | "credit-note"
  | "packing-slip"
  | "return"
  | "draft";

export type EmailTemplateDesign = {
  headerColor: string;
  accentColor: string;
  includeLogo: boolean;
  footerText: string;
};

export type EmailTemplate = {
  subject: string;
  body: string;
  attachPdf: boolean;
};

export type EmailTemplatesSettings = {
  design: EmailTemplateDesign;
  templates: Record<EmailDocumentKind, EmailTemplate>;
  /** Bumped when built-in ready copy for all document types changes. */
  readySetVersion: number;
};

/** Current built-in ready email copy — matched body style for all kinds. */
export const EMAIL_TEMPLATES_READY_SET_VERSION = 4;

export const EMAIL_DOCUMENT_KINDS: ReadonlyArray<{
  id: EmailDocumentKind;
  label: string;
}> = [
  { id: "sales-order", label: "Sales order" },
  { id: "invoice", label: "Invoice" },
  { id: "draft", label: "Draft" },
  { id: "credit-note", label: "Credit note" },
  { id: "packing-slip", label: "Packing slip" },
  { id: "return", label: "Return" },
];

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  "{{documentType}}",
  "{{documentNumber}}",
  "{{orderName}}",
  "{{customerName}}",
  "{{total}}",
  "{{currency}}",
  "{{storeName}}",
  "{{referenceNumber}}",
] as const;

export type EmailTemplateVars = {
  documentType: string;
  documentNumber: string;
  orderName: string;
  customerName: string;
  total: string;
  currency: string;
  storeName: string;
  referenceNumber: string;
};

/** Clean modern defaults — charcoal + teal accent (not purple). */
const defaultDesign: EmailTemplateDesign = {
  headerColor: "#111827",
  accentColor: "#0f766e",
  includeLogo: true,
  footerText: "Sent with Billoxi · Thank you for your business.",
};

function defaultTemplate(kind: EmailDocumentKind): EmailTemplate {
  switch (kind) {
    case "sales-order":
      return {
        subject: `Sales order {{documentNumber}} · {{storeName}}`,
        body: [
          `<p>Hello {{customerName}},</p>`,
          `<p><strong>Your sales order is ready for review.</strong> Please check the details below.</p>`,
          `<p><strong>Sales order:</strong> {{documentNumber}}<br><strong>Order:</strong> {{orderName}}<br><strong>Total:</strong> {{currency}} {{total}}</p>`,
          `<p>The sales order PDF is attached. Reply to this email if you need any changes.</p>`,
          `<p>Best regards,<br><strong>{{storeName}}</strong></p>`,
        ].join(""),
        attachPdf: true,
      };
    case "invoice":
      return {
        subject: `Invoice {{documentNumber}} · {{storeName}}`,
        body: [
          `<p>Hello {{customerName}},</p>`,
          `<p><strong>Your invoice is ready for review.</strong> Please check the details below.</p>`,
          `<p><strong>Invoice:</strong> {{documentNumber}}<br><strong>Order:</strong> {{orderName}}<br><strong>Total:</strong> {{currency}} {{total}}</p>`,
          `<p>The invoice PDF is attached. If you have already paid, you can disregard this notice. Reply if you have any questions.</p>`,
          `<p>Best regards,<br><strong>{{storeName}}</strong></p>`,
        ].join(""),
        attachPdf: true,
      };
    case "draft":
      return {
        subject: `Draft {{documentNumber}} · {{storeName}}`,
        body: [
          `<p>Hello {{customerName}},</p>`,
          `<p><strong>Your draft document is ready for review.</strong> Please check the details below.</p>`,
          `<p><strong>Draft:</strong> {{documentNumber}}<br><strong>Reference:</strong> {{orderName}}<br><strong>Total:</strong> {{currency}} {{total}}</p>`,
          `<p>The draft PDF is attached. This is not a final invoice — reply if you need any changes before we proceed.</p>`,
          `<p>Best regards,<br><strong>{{storeName}}</strong></p>`,
        ].join(""),
        attachPdf: true,
      };
    case "credit-note":
      return {
        subject: `Credit note {{documentNumber}} · {{storeName}}`,
        body: [
          `<p>Hello {{customerName}},</p>`,
          `<p><strong>Your credit note is ready for review.</strong> Please check the details below.</p>`,
          `<p><strong>Credit note:</strong> {{documentNumber}}<br><strong>Order:</strong> {{orderName}}<br><strong>Credit amount:</strong> {{currency}} {{total}}<br><strong>Reference:</strong> {{referenceNumber}}</p>`,
          `<p>The credit note PDF is attached. This amount will be applied per our store policy — reply if you have any questions.</p>`,
          `<p>Best regards,<br><strong>{{storeName}}</strong></p>`,
        ].join(""),
        attachPdf: true,
      };
    case "packing-slip":
      return {
        subject: `Packing slip {{documentNumber}} · {{storeName}}`,
        body: [
          `<p>Hello {{customerName}},</p>`,
          `<p><strong>Your packing slip is ready for review.</strong> Please check the details below.</p>`,
          `<p><strong>Packing slip:</strong> {{documentNumber}}<br><strong>Order:</strong> {{orderName}}<br><strong>Reference:</strong> {{referenceNumber}}</p>`,
          `<p>The packing slip PDF is attached so you can check what should be in your package. Reply if you have any questions.</p>`,
          `<p>Best regards,<br><strong>{{storeName}}</strong></p>`,
        ].join(""),
        attachPdf: true,
      };
    case "return":
      return {
        subject: `Return {{documentNumber}} · {{storeName}}`,
        body: [
          `<p>Hello {{customerName}},</p>`,
          `<p><strong>Your return document is ready for review.</strong> Please check the details below.</p>`,
          `<p><strong>Return:</strong> {{documentNumber}}<br><strong>Order:</strong> {{orderName}}<br><strong>Reference:</strong> {{referenceNumber}}</p>`,
          `<p>The return PDF is attached. Reply to this email if you have any questions about this return.</p>`,
          `<p>Best regards,<br><strong>{{storeName}}</strong></p>`,
        ].join(""),
        attachPdf: true,
      };
  }
}

/** Built-in ready template for a document type (used by Reset). */
export function getDefaultEmailTemplate(kind: EmailDocumentKind): EmailTemplate {
  return structuredClone(defaultTemplate(kind));
}

/** True when body still matches the first generic starter copy. */
function isLegacyStarterBody(body: string, kind: EmailDocumentKind): boolean {
  const plain = plainTextFromHtml(body).toLowerCase().replace(/\s+/g, " ");
  if (!plain.includes("the pdf is attached for your records")) return false;
  if (!plain.includes("document:")) return false;
  switch (kind) {
    case "sales-order":
      return plain.includes("your sales order is ready");
    case "invoice":
      return plain.includes("your invoice is ready.") && !plain.includes("amount due");
    case "draft":
      return plain.includes("your draft is ready");
    case "credit-note":
      return plain.includes("your credit note is ready");
    case "packing-slip":
      return plain.includes("your packing slip is ready");
    case "return":
      return plain.includes("your return is ready");
  }
}

export const emptyEmailTemplatesSettings: EmailTemplatesSettings = {
  design: { ...defaultDesign },
  templates: {
    "sales-order": defaultTemplate("sales-order"),
    invoice: defaultTemplate("invoice"),
    draft: defaultTemplate("draft"),
    "credit-note": defaultTemplate("credit-note"),
    "packing-slip": defaultTemplate("packing-slip"),
    return: defaultTemplate("return"),
  },
  readySetVersion: EMAIL_TEMPLATES_READY_SET_VERSION,
};

/** All document send templates (fresh ready copies). */
export function getReadyEmailTemplates(): Record<
  EmailDocumentKind,
  EmailTemplate
> {
  return {
    "sales-order": getDefaultEmailTemplate("sales-order"),
    invoice: getDefaultEmailTemplate("invoice"),
    draft: getDefaultEmailTemplate("draft"),
    "credit-note": getDefaultEmailTemplate("credit-note"),
    "packing-slip": getDefaultEmailTemplate("packing-slip"),
    return: getDefaultEmailTemplate("return"),
  };
}

export function emailTemplatesNeedReadySeed(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const version = (value as { readySetVersion?: unknown }).readySetVersion;
  return (
    typeof version !== "number" || version < EMAIL_TEMPLATES_READY_SET_VERSION
  );
}

function asTrimmedString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asColor(value: unknown, fallback: string): string {
  const raw = asTrimmedString(value);
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
  return fallback;
}

function normalizeTemplate(
  value: unknown,
  kind: EmailDocumentKind,
): EmailTemplate {
  const defaults = defaultTemplate(kind);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(defaults);
  }
  const input = value as Partial<EmailTemplate>;
  const rawBody = typeof input.body === "string" ? input.body : defaults.body;
  if (isLegacyStarterBody(rawBody, kind)) {
    return structuredClone(defaults);
  }
  return {
    subject: asTrimmedString(input.subject, defaults.subject) || defaults.subject,
    body: normalizeBodyForEditor(rawBody),
    attachPdf: input.attachPdf !== undefined ? Boolean(input.attachPdf) : true,
  };
}

export function normalizeEmailTemplatesSettings(
  value: unknown,
): EmailTemplatesSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(emptyEmailTemplatesSettings);
  }

  const input = value as {
    design?: Partial<EmailTemplateDesign> | null;
    templates?: Partial<Record<EmailDocumentKind, unknown>> | null;
    readySetVersion?: unknown;
  };

  const designInput = input.design ?? {};
  const design: EmailTemplateDesign = {
    headerColor: asColor(designInput.headerColor, defaultDesign.headerColor),
    accentColor: asColor(designInput.accentColor, defaultDesign.accentColor),
    includeLogo:
      designInput.includeLogo !== undefined
        ? Boolean(designInput.includeLogo)
        : defaultDesign.includeLogo,
    footerText: asTrimmedString(
      designInput.footerText,
      defaultDesign.footerText,
    ),
  };

  const storedVersion =
    typeof input.readySetVersion === "number" ? input.readySetVersion : 0;

  // Seed ready templates when the built-in set changes (matched body copy).
  if (storedVersion < EMAIL_TEMPLATES_READY_SET_VERSION) {
    return {
      design,
      templates: getReadyEmailTemplates(),
      readySetVersion: EMAIL_TEMPLATES_READY_SET_VERSION,
    };
  }

  return {
    design,
    templates: {
      "sales-order": normalizeTemplate(
        input.templates?.["sales-order"],
        "sales-order",
      ),
      invoice: normalizeTemplate(input.templates?.invoice, "invoice"),
      draft: normalizeTemplate(input.templates?.draft, "draft"),
      "credit-note": normalizeTemplate(
        input.templates?.["credit-note"],
        "credit-note",
      ),
      "packing-slip": normalizeTemplate(
        input.templates?.["packing-slip"],
        "packing-slip",
      ),
      return: normalizeTemplate(input.templates?.return, "return"),
    },
    readySetVersion: EMAIL_TEMPLATES_READY_SET_VERSION,
  };
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function applyEmailTemplateVars(
  template: string,
  vars: EmailTemplateVars,
  options?: { html?: boolean },
): string {
  const html = options?.html ?? looksLikeHtml(template);
  const v = html
    ? {
        documentType: escapeHtml(vars.documentType),
        documentNumber: escapeHtml(vars.documentNumber),
        orderName: escapeHtml(vars.orderName),
        customerName: escapeHtml(vars.customerName),
        total: escapeHtml(vars.total),
        currency: escapeHtml(vars.currency),
        storeName: escapeHtml(vars.storeName),
        referenceNumber: escapeHtml(vars.referenceNumber),
      }
    : vars;

  return template
    .replaceAll("{{documentType}}", v.documentType)
    .replaceAll("{{documentNumber}}", v.documentNumber)
    .replaceAll("{{orderName}}", v.orderName)
    .replaceAll("{{customerName}}", v.customerName)
    .replaceAll("{{total}}", v.total)
    .replaceAll("{{currency}}", v.currency)
    .replaceAll("{{storeName}}", v.storeName)
    .replaceAll("{{referenceNumber}}", v.referenceNumber);
}

/** Ensure body is editor-ready HTML (migrates legacy plain text). */
export function normalizeBodyForEditor(body: string): string {
  const value = typeof body === "string" ? body : "";
  if (!value.trim()) return "<p><br></p>";
  if (looksLikeHtml(value)) return value;
  return value
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
    .join("");
}

/** Strip tags for mailto / text/plain parts. */
export function plainTextFromHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lightweight allowlist sanitize for merchant-authored email body HTML. */
export function sanitizeEmailBodyHtml(html: string): string {
  return html
    .replace(/<\/?(script|style|iframe|object|embed|link|meta|form|input|button|svg|math)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, "$1=$2#$2")
    .replace(/javascript:/gi, "");
}

/** Convert stored body (plain or HTML) into safe HTML for the email card. */
export function bodyContentToHtml(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (!looksLikeHtml(trimmed)) {
    return escapeHtml(trimmed).replaceAll("\n", "<br />");
  }
  return sanitizeEmailBodyHtml(trimmed);
}

export function documentKindLabel(kind: EmailDocumentKind): string {
  switch (kind) {
    case "invoice":
      return "Invoice";
    case "draft":
      return "Draft";
    case "credit-note":
      return "Credit Note";
    case "packing-slip":
      return "Packing Slip";
    case "return":
      return "Return";
    default:
      return "Sales Order";
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Professional modern HTML email — clean card, accent bar, meta row, amount panel. */
export function buildEmailHtml(options: {
  design: EmailTemplateDesign;
  bodyText: string;
  storeName: string;
  logoDataUrl?: string | null;
  vars?: Pick<
    EmailTemplateVars,
    "documentType" | "documentNumber" | "total" | "currency" | "orderName"
  > | null;
}): string {
  const { design, bodyText, storeName, logoDataUrl, vars } = options;
  const bodyHtml = bodyContentToHtml(bodyText);
  const logoBlock =
    design.includeLogo && logoDataUrl
      ? `<img src="${logoDataUrl}" alt="${escapeHtml(storeName)}" width="140" style="max-height:40px;max-width:140px;display:block;margin:0 0 12px 0;border:0;" />`
      : "";

  const metaRow =
    vars?.documentType || vars?.documentNumber
      ? `<tr>
            <td style="padding:0 32px 8px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding:0;">
                    <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${design.accentColor}14;color:${design.accentColor};font-size:12px;font-weight:650;letter-spacing:0.02em;">${escapeHtml(vars.documentType || "Document")}</span>
                  </td>
                  <td align="right" style="padding:0;font-size:13px;color:#6b7280;font-weight:500;">
                    ${escapeHtml(vars.documentNumber || "")}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : "";

  const amountPanel =
    vars?.total
      ? `<tr>
            <td style="padding:8px 32px 20px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#6b7280;">Amount</td>
                  <td align="right" style="padding:14px 16px;font-size:18px;font-weight:700;color:#111827;">
                    ${escapeHtml([vars.currency, vars.total].filter(Boolean).join(" "))}
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
      : "";

  const headerBlock = design.includeLogo
    ? `<tr>
            <td style="background:${design.headerColor};padding:28px 32px;">
              ${logoBlock}
              <div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;line-height:1.25;color:#ffffff;letter-spacing:-0.02em;">${escapeHtml(storeName)}</div>
              <div style="margin-top:6px;height:3px;width:40px;background:${design.accentColor};border-radius:2px;"></div>
            </td>
          </tr>`
    : `<tr>
            <td style="padding:0;height:4px;background:${design.accentColor};font-size:0;line-height:0;">&nbsp;</td>
          </tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(vars?.documentType || "Document")}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Inter,Helvetica,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          ${headerBlock}
          <tr>
            <td style="padding:28px 32px 12px 32px;font-size:15px;line-height:1.65;color:#374151;">
              ${bodyHtml}
            </td>
          </tr>
          ${metaRow}
          ${amountPanel}
          <tr>
            <td style="padding:8px 32px 28px 32px;border-top:1px solid #f3f4f6;font-size:12px;line-height:1.5;color:#9ca3af;">
              ${escapeHtml(design.footerText)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
