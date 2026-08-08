import type {
  DocumentEventKind,
  DocumentEventProcessType,
} from "./document-event-log";

type DocumentActivityMetric = "printed" | "downloaded" | "sent" | "uploaded";

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
  if (/^\d+$/.test(raw)) return `gid://shopify/Order/${raw}`;
  if (raw.includes("/")) {
    const last = raw.split("/").pop();
    if (last && /^\d+$/.test(last)) return `gid://shopify/Order/${last}`;
  }
  return raw;
}

function toOrderName(value?: string | null, gid?: string | null): string | null {
  const name = value?.trim();
  if (name) return name.startsWith("#") ? name : `#${name.replace(/^#/, "")}`;
  const fromGid = gid?.split("/").pop();
  if (fromGid && /^\d+$/.test(fromGid)) return `#${fromGid}`;
  return null;
}

async function activityHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
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
      const body = new URLSearchParams();
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

      await fetch("/app/activity", {
        method: "POST",
        body,
        headers: await activityHeaders(),
        credentials: "same-origin",
      });
    } catch {
      // Ignore analytics failures — never block print/download UX.
    }
  })();
}
