export type SmtpEncryption = "none" | "tls" | "ssl";

export type SmtpSettings = {
  enabled: boolean;
  host: string;
  port: string;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  encryption: SmtpEncryption;
};

export const emptySmtpSettings: SmtpSettings = {
  enabled: false,
  host: "",
  port: "587",
  username: "",
  password: "",
  fromEmail: "",
  fromName: "",
  encryption: "tls",
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asEncryption(value: unknown): SmtpEncryption {
  if (value === "none" || value === "ssl" || value === "tls") return value;
  return "tls";
}

export function normalizeSmtpSettings(value: unknown): SmtpSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...emptySmtpSettings };
  }

  const input = value as Partial<SmtpSettings>;
  const host = asTrimmedString(input.host);
  return {
    enabled:
      input.enabled !== undefined ? Boolean(input.enabled) : Boolean(host),
    host,
    port: asTrimmedString(input.port) || "587",
    username: asTrimmedString(input.username),
    password: asTrimmedString(input.password),
    fromEmail: asTrimmedString(input.fromEmail),
    fromName: asTrimmedString(input.fromName),
    encryption: asEncryption(input.encryption),
  };
}

/** True when Send Email can deliver through the app (not mailto). */
export function isSmtpReadyForSend(settings: SmtpSettings): boolean {
  return Boolean(
    settings.enabled &&
      settings.host &&
      settings.fromEmail &&
      settings.username &&
      settings.password,
  );
}

export const SMTP_REQUIRED_NOTICE =
  "Set up SMTP in Settings → SMTP first. Email can only be sent after SMTP is configured.";

export const GMAIL_SMTP_PRESET: Pick<
  SmtpSettings,
  "host" | "port" | "encryption" | "enabled"
> = {
  enabled: true,
  host: "smtp.gmail.com",
  port: "587",
  encryption: "tls",
};

/** Typical Hostinger / cPanel webmail defaults — replace host if your provider differs. */
export const WEBMAIL_SMTP_PRESET: Pick<
  SmtpSettings,
  "host" | "port" | "encryption" | "enabled"
> = {
  enabled: true,
  host: "smtp.hostinger.com",
  port: "465",
  encryption: "ssl",
};
