export type StoreCustomField = {
  id: string;
  label: string;
  value: string;
};

export type StoreDetails = {
  name: string;
  /** Full free-form address (multiline). */
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Shared document logo (data URL). Used by all templates. */
  logoDataUrl?: string;
  logoFileName?: string;
  customFields: StoreCustomField[];
};

export const emptyStoreDetails: StoreDetails = {
  name: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  customFields: [],
};

const LOGO_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,/i;
const MAX_LOGO_DATA_URL_LENGTH = 1_500_000;

export function normalizeStoreLogoDataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!LOGO_DATA_URL_RE.test(trimmed)) return undefined;
  if (trimmed.length > MAX_LOGO_DATA_URL_LENGTH) return undefined;
  return trimmed;
}

type ShopAddress = {
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
};

type LegacyStoreAddressFields = {
  address?: unknown;
  address1?: unknown;
  address2?: unknown;
  city?: unknown;
  province?: unknown;
  zip?: unknown;
  country?: unknown;
};

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Display store domain without protocol: www.example.com */
export function formatStoreWebsite(website: string): string {
  let value = website.trim();
  if (!value) return "";
  value = value.replace(/^https?:\/\//i, "");
  // Keep host only (store domain), drop path/query/hash.
  value = (value.split(/[/?#]/)[0] || "").replace(/\/+$/, "");
  if (!value) return "";
  if (!/^www\./i.test(value)) {
    value = `www.${value}`;
  }
  return value;
}

/** Preserve internal newlines; trim overall edges only. */
function asAddressString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/^\s+|\s+$/g, "");
}

function composeLegacyAddress(input: LegacyStoreAddressFields): string {
  const lines: string[] = [];
  const address1 = asTrimmedString(input.address1);
  const address2 = asTrimmedString(input.address2);
  const city = asTrimmedString(input.city);
  const province = asTrimmedString(input.province);
  const zip = asTrimmedString(input.zip);
  const country = asTrimmedString(input.country);

  if (address1) lines.push(address1);
  if (address2) lines.push(address2);

  const cityLine = [city, province, zip].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (country) lines.push(country);

  return lines.join("\n");
}

function composeShopAddress(address: ShopAddress): string {
  return composeLegacyAddress({
    address1: address.address1,
    address2: address.address2,
    city: address.city,
    province: address.province,
    zip: address.zip,
    country: address.country,
  });
}

export function normalizeStoreCustomFields(value: unknown): StoreCustomField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const fields: StoreCustomField[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const field = entry as Partial<StoreCustomField>;
    const id =
      typeof field.id === "string" && field.id.trim()
        ? field.id.trim()
        : `custom-${fields.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    fields.push({
      id,
      label: asTrimmedString(field.label),
      value: asTrimmedString(field.value),
    });
  }
  return fields;
}

export function normalizeStoreDetails(value: unknown): StoreDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...emptyStoreDetails, customFields: [] };
  }
  const input = value as Partial<StoreDetails> & LegacyStoreAddressFields;
  const address =
    asAddressString(input.address) || composeLegacyAddress(input);
  const logoDataUrl = normalizeStoreLogoDataUrl(
    (input as { logoDataUrl?: unknown }).logoDataUrl,
  );
  const logoFileName = asTrimmedString(
    (input as { logoFileName?: unknown }).logoFileName,
  );
  return {
    name: asTrimmedString(input.name),
    address,
    phone: asTrimmedString(input.phone),
    email: asTrimmedString(input.email),
    website: formatStoreWebsite(asTrimmedString(input.website)),
    ...(logoDataUrl
      ? {
          logoDataUrl,
          ...(logoFileName ? { logoFileName } : {}),
        }
      : {}),
    customFields: normalizeStoreCustomFields(input.customFields),
  };
}

export function storeDetailsFromShop(shop: {
  name?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  primaryDomainUrl?: string | null;
  shopAddress?: ShopAddress | null;
}): StoreDetails {
  const address = shop.shopAddress ?? {};
  return {
    name: asTrimmedString(address.company) || asTrimmedString(shop.name),
    address: composeShopAddress(address),
    phone: asTrimmedString(address.phone),
    email:
      asTrimmedString(shop.contactEmail) || asTrimmedString(shop.email),
    website: formatStoreWebsite(asTrimmedString(shop.primaryDomainUrl)),
    customFields: [],
  };
}

function hasCoreStoreValues(details: StoreDetails): boolean {
  return Boolean(
    details.name ||
      details.address ||
      details.phone ||
      details.email ||
      details.website ||
      details.customFields.length,
  );
}

export function mergeStoreDetails(
  saved: unknown,
  shopDefaults: StoreDetails,
): StoreDetails {
  const normalized = normalizeStoreDetails(saved);
  if (!hasCoreStoreValues(normalized)) {
    return { ...shopDefaults, customFields: [] };
  }

  return {
    name: normalized.name || shopDefaults.name,
    address: normalized.address || shopDefaults.address,
    phone: normalized.phone || shopDefaults.phone,
    email: normalized.email || shopDefaults.email,
    website: normalized.website || shopDefaults.website,
    ...(normalized.logoDataUrl
      ? {
          logoDataUrl: normalized.logoDataUrl,
          ...(normalized.logoFileName
            ? { logoFileName: normalized.logoFileName }
            : {}),
        }
      : shopDefaults.logoDataUrl
        ? {
            logoDataUrl: shopDefaults.logoDataUrl,
            ...(shopDefaults.logoFileName
              ? { logoFileName: shopDefaults.logoFileName }
              : {}),
          }
        : {}),
    customFields: normalized.customFields,
  };
}

export function formatStoreAddressLines(details: StoreDetails): string[] {
  const lines: string[] = [];

  for (const line of details.address.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }

  if (details.phone) lines.push(`Phone: ${details.phone}`);
  if (details.email) lines.push(`Email: ${details.email}`);
  if (details.website) lines.push(`Website: ${formatStoreWebsite(details.website)}`);

  for (const field of details.customFields) {
    if (!field.label && !field.value) continue;
    if (field.label && field.value) {
      lines.push(`${field.label}: ${field.value}`);
    } else {
      lines.push(field.label || field.value);
    }
  }

  return lines;
}

export function createStoreCustomField(): StoreCustomField {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, label: "", value: "" };
}
