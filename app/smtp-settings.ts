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
  return {
    enabled: Boolean(input.enabled),
    host: asTrimmedString(input.host),
    port: asTrimmedString(input.port) || "587",
    username: asTrimmedString(input.username),
    password: asTrimmedString(input.password),
    fromEmail: asTrimmedString(input.fromEmail),
    fromName: asTrimmedString(input.fromName),
    encryption: asEncryption(input.encryption),
  };
}
