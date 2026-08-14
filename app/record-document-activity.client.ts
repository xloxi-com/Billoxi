import type {
  DocumentEventKind,
  DocumentEventProcessType,
} from "./document-event-log";

type DocumentActivityMetric = "printed" | "downloaded" | "sent" | "uploaded";

export const DOCUMENT_ACTIVITY_RECORDED_EVENT = "billoxi:document-activity-recorded";

export type RecordDocumentActivityOptions = {
  count?: number;
  documentKind?: DocumentEventKind | string | null;
  documentNumber?: string | null;
  orderGid?: string | null;
  orderName?: string | null;
  /** Alias accepted for callers that pass Shopify order id / name. */
  orderId?: string | null;
  processType?: DocumentEventProcessType;
};

function toOrderGid(value?: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("gid://shopify/Order/")) return raw;
  if (raw.startsWith("gid://shopify/DraftOrder/")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Order/${raw}`;
  if (raw.includes("/")) {
    const last = raw.split("/").pop();
    if (last && /^\d+$/.test(last)) return `gid://shopify/Order/${last}`;
  }
  return raw;
}

function toOrderName(value?: string | null, gid?: string | null): string | null {
  const name = value?.trim();
  if (!name) return null;
  const formatted = name.startsWith("#") ? name : `#${name.replace(/^#/, "")}`;
  const bare = formatted.replace(/^#/, "");
  const fromGid = gid?.split("/").pop();
  // Never treat the Shopify numeric Order id as the merchant order name.
  if (fromGid && bare === fromGid) return null;
  return formatted;
}

async function activityHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {};
  try {
    const shopify = (window as Window & {
      shopify?: { idToken?: () => Promise<string> };
    }).shopify;
    if (shopify?.idToken) {
      const token = await shopify.idToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Cookie session still works for same-origin posts.
  }
  return headers;
}

function showQuotaToast(message: string) {
  try {
    const shopify = (window as Window & {
      shopify?: { toast?: { show: (msg: string, opts?: { isError?: boolean }) => void } };
    }).shopify;
    shopify?.toast?.show(message, { isError: true });
  } catch {
    // ignore
  }
}

/** Preflight before print / download / email. Already-used orders this month pass. */
export async function ensureOrderQuotaAllows(
  orderGid?: string | null | Array<string | null | undefined>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof window === "undefined") return { ok: true };
  try {
    const params = new URLSearchParams();
    const rawList = Array.isArray(orderGid) ? orderGid : [orderGid];
    for (const raw of rawList) {
      const gid = toOrderGid(raw);
      if (gid) params.append("orderGid", gid);
    }
    const response = await fetch(`/app/order-quota?${params}`, {
      method: "GET",
      headers: await activityHeaders(),
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => null)) as {
      allowed?: boolean;
      error?: string | null;
      quota?: { used?: number; limit?: number | null };
    } | null;
    if (!response.ok || payload?.allowed === false) {
      const error =
        payload?.error ||
        (payload?.quota?.limit != null
          ? `Monthly order limit reached (${payload.quota.used}/${payload.quota.limit}). Upgrade or wait until next month.`
          : "Monthly order limit reached. Upgrade or wait until next month.");
      showQuotaToast(error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch {
    // Fail open on network blips — server still enforces on activity / email.
    return { ok: true };
  }
}

/** Fire-and-forget home Analytics + Event Logs after client print/download. */
export function recordDocumentActivity(
  metric: DocumentActivityMetric,
  options: RecordDocumentActivityOptions | number = 1,
): void {
  if (typeof window === "undefined") return;
  const opts =
    typeof options === "number" ? { count: options } : options || {};
  const count = opts.count ?? 1;
  if (count <= 0) return;

  const orderGid = toOrderGid(opts.orderGid || opts.orderId || null);
  const orderName = toOrderName(opts.orderName || null, orderGid);

  void (async () => {
    try {
      const body = new FormData();
      body.set("metric", metric);
      body.set("count", String(count));
      if (opts.documentKind) {
        body.set("documentKind", String(opts.documentKind));
      }
      if (opts.documentNumber) {
        body.set("documentNumber", String(opts.documentNumber));
      }
      if (orderGid) {
        body.set("orderGid", orderGid);
        body.set("orderId", orderGid);
      }
      if (orderName) body.set("orderName", orderName);
      body.set("processType", opts.processType || "manual");

      const response = await fetch("/app/activity", {
        method: "POST",
        body,
        headers: await activityHeaders(),
        credentials: "same-origin",
      });
      if (response.ok) {
        window.dispatchEvent(
          new CustomEvent(DOCUMENT_ACTIVITY_RECORDED_EVENT),
        );
        return;
      }
      if (response.status === 403) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (payload?.error) showQuotaToast(payload.error);
      }
    } catch {
      // Ignore analytics failures — never block print/download UX.
    }
  })();
}
