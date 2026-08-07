import nodemailer from "nodemailer";

import {
  applyEmailTemplateVars,
  buildEmailHtml,
  documentKindLabel,
  looksLikeHtml,
  plainTextFromHtml,
  type EmailDocumentKind,
  type EmailTemplateVars,
  type EmailTemplatesSettings,
} from "./email-templates";
import type { SmtpSettings } from "./smtp-settings";
import type { StoreDetails } from "./store-details";
import { buildSalesOrderPdfFile } from "./sales-order-bulk-pdf.server";
import {
  loadEmailTemplatesForShop,
  loadSmtpSettingsForShop,
  loadStoreDetailsForShop,
} from "./shop-settings.server";

export type SendDocumentEmailResult =
  | {
      ok: true;
      mode: "smtp";
      to: string;
      attachedPdf: boolean;
    }
  | {
      ok: true;
      mode: "mailto";
      to: string;
      subject: string;
      body: string;
    }
  | {
      ok: false;
      error: string;
    };

function smtpPort(settings: SmtpSettings): number {
  const parsed = Number.parseInt(settings.port, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 587;
}

function createTransport(settings: SmtpSettings) {
  const port = smtpPort(settings);
  const secure =
    settings.encryption === "ssl" || port === 465;
  return nodemailer.createTransport({
    host: settings.host,
    port,
    secure,
    requireTLS: settings.encryption === "tls" && !secure,
    auth:
      settings.username || settings.password
        ? {
            user: settings.username,
            pass: settings.password,
          }
        : undefined,
  });
}

export function resolveEmailVars(options: {
  kind: EmailDocumentKind;
  documentNumber: string;
  orderName: string;
  customerName: string;
  total: string;
  currency: string;
  storeName: string;
  referenceNumber?: string | null;
}): EmailTemplateVars {
  return {
    documentType: documentKindLabel(options.kind),
    documentNumber: options.documentNumber || options.orderName,
    orderName: options.orderName,
    customerName: options.customerName || "Customer",
    total: options.total,
    currency: options.currency,
    storeName: options.storeName || "Store",
    referenceNumber: options.referenceNumber?.trim() || "",
  };
}

export async function sendDocumentEmail(args: {
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  };
  shop: string;
  orderId: string;
  documentKind: EmailDocumentKind;
  toEmail: string;
  documentNumber: string;
  orderName: string;
  customerName: string;
  total: string;
  currency: string;
  referenceNumber?: string | null;
  templateId?: string | null;
  /** Prefer client DOM PDF (same as Download) over server jsPDF fallback. */
  pdfAttachment?: {
    filename: string;
    content: Buffer;
  } | null;
}): Promise<SendDocumentEmailResult> {
  const to = args.toEmail.trim();
  if (!to) {
    return { ok: false, error: "No customer email on this order" };
  }

  const [smtp, emailTemplates, storeDetails] = await Promise.all([
    loadSmtpSettingsForShop(args.shop),
    loadEmailTemplatesForShop(args.shop),
    loadStoreDetailsForShop(args.shop, args.admin),
  ]);

  const template = emailTemplates.templates[args.documentKind];
  const vars = resolveEmailVars({
    kind: args.documentKind,
    documentNumber: args.documentNumber,
    orderName: args.orderName,
    customerName: args.customerName,
    total: args.total,
    currency: args.currency,
    storeName: storeDetails.name,
    referenceNumber: args.referenceNumber,
  });

  const subject = applyEmailTemplateVars(template.subject, vars);
  const bodyContent = applyEmailTemplateVars(template.body, vars);
  const plainBody = looksLikeHtml(template.body)
    ? plainTextFromHtml(bodyContent)
    : bodyContent;

  if (!smtp.enabled || !smtp.host) {
    return {
      ok: true,
      mode: "mailto",
      to,
      subject,
      body: plainBody,
    };
  }

  if (!smtp.fromEmail) {
    return {
      ok: false,
      error: "Set a From email in Settings → SMTP before sending.",
    };
  }

  let pdfAttachment:
    | { filename: string; content: Buffer; contentType: string }
    | undefined;

  if (template.attachPdf) {
    try {
      if (args.pdfAttachment?.content?.length) {
        pdfAttachment = {
          filename: args.pdfAttachment.filename || "document.pdf",
          content: args.pdfAttachment.content,
          contentType: "application/pdf",
        };
      } else {
        const { pdf, fileName } = await buildSalesOrderPdfFile({
          admin: args.admin,
          shop: args.shop,
          orderId: args.orderId,
          templateId: args.templateId,
          documentKind: args.documentKind,
        });
        pdfAttachment = {
          filename: fileName,
          content: Buffer.from(pdf),
          contentType: "application/pdf",
        };
      }
    } catch (error) {
      console.error("PDF attach failed:", error);
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not generate PDF attachment",
      };
    }
  }

  const html = buildEmailHtml({
    design: emailTemplates.design,
    bodyText: bodyContent,
    storeName: storeDetails.name || vars.storeName,
    logoDataUrl: storeDetails.logoDataUrl || null,
    vars: {
      documentType: vars.documentType,
      documentNumber: vars.documentNumber,
      orderName: vars.orderName,
      total: vars.total,
      currency: vars.currency,
    },
  });

  try {
    const transport = createTransport(smtp);
    await transport.sendMail({
      from: smtp.fromName
        ? `"${smtp.fromName}" <${smtp.fromEmail}>`
        : smtp.fromEmail,
      to,
      subject,
      text: plainBody,
      html,
      attachments: pdfAttachment ? [pdfAttachment] : undefined,
    });
  } catch (error) {
    console.error("SMTP send failed:", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to send email via SMTP",
    };
  }

  return {
    ok: true,
    mode: "smtp",
    to,
    attachedPdf: Boolean(pdfAttachment),
  };
}

export type { EmailTemplatesSettings, StoreDetails };
