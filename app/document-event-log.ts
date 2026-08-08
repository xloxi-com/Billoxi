export type DocumentEventAction =
  | "printed"
  | "downloaded"
  | "sent"
  | "uploaded";

export type DocumentEventProcessType = "manual" | "bulk" | "extension";

export type DocumentEventKind =
  | "sales-order"
  | "invoice"
  | "credit-note"
  | "packing-slip";

export type DocumentEventLogItem = {
  id: string;
  action: DocumentEventAction;
  documentKind: string | null;
  documentNumber: string | null;
  orderGid: string | null;
  orderName: string | null;
  processType: DocumentEventProcessType | null;
  count: number;
  message: string;
  createdAt: string;
};

const ACTION_PHRASE: Record<DocumentEventAction, string> = {
  printed: "printed",
  downloaded: "downloaded",
  sent: "sent",
  uploaded: "uploaded",
};

const KIND_LABEL: Record<string, string> = {
  "sales-order": "sales order",
  invoice: "invoice",
  "credit-note": "credit note",
  "packing-slip": "packing slip",
};

const PROCESS_LABEL: Record<DocumentEventProcessType, string> = {
  manual: "Manual process",
  bulk: "Bulk process",
  extension: "Order admin",
};

const GRID_LABEL: Record<string, string> = {
  "sales-order": "Sales Orders grid",
  invoice: "Invoices grid",
  "credit-note": "Credit Notes grid",
  "packing-slip": "Packing Slips grid",
};

export function isDocumentEventAction(
  value: string,
): value is DocumentEventAction {
  return (
    value === "printed" ||
    value === "downloaded" ||
    value === "sent" ||
    value === "uploaded"
  );
}

export function isDocumentEventProcessType(
  value: string | null | undefined,
): value is DocumentEventProcessType {
  return value === "manual" || value === "bulk" || value === "extension";
}

export function documentKindLabel(kind?: string | null): string {
  if (!kind) return "document";
  return KIND_LABEL[kind] || kind.replace(/-/g, " ");
}

export function processTypeLabel(
  processType?: string | null,
): string {
  if (isDocumentEventProcessType(processType)) {
    return PROCESS_LABEL[processType];
  }
  return "Manual process";
}

export function formatOrderIdLabel(
  orderName?: string | null,
  orderGid?: string | null,
): string {
  const name = orderName?.trim();
  if (name) {
    return name.startsWith("#") ? name : `#${name.replace(/^#/, "")}`;
  }
  const gid = orderGid?.trim();
  if (!gid) return "—";
  const numeric = gid.includes("/")
    ? gid.split("/").pop()
    : /^\d+$/.test(gid)
      ? gid
      : null;
  return numeric ? `#${numeric}` : "—";
}

export function orderIdHref(
  orderGid?: string | null,
  documentKind?: string | null,
): string | null {
  const gid = orderGid?.trim();
  if (!gid) return null;
  const numeric = gid.includes("/")
    ? gid.split("/").pop()
    : /^\d+$/.test(gid)
      ? gid
      : null;
  if (!numeric || !/^\d+$/.test(numeric)) return null;
  const base =
    documentKind === "invoice"
      ? "/app/invoice"
      : documentKind === "credit-note"
        ? "/app/credit-note"
        : documentKind === "packing-slip"
          ? "/app/packing-slip"
          : "/app/sales-order";
  return `${base}/${encodeURIComponent(numeric)}`;
}

export function buildDocumentEventMessage(args: {
  action: DocumentEventAction;
  count: number;
  documentKind?: string | null;
  documentNumber?: string | null;
  orderName?: string | null;
  orderGid?: string | null;
  processType?: string | null;
}): string {
  const verb = ACTION_PHRASE[args.action];
  const kind = documentKindLabel(args.documentKind);
  const orderLabel = formatOrderIdLabel(args.orderName, args.orderGid);
  const grid =
    GRID_LABEL[args.documentKind || ""] || "Billoxi documents";
  const docNumber = args.documentNumber?.trim();

  if (args.count > 1) {
    return `You have ${verb} ${args.count} ${kind}s from your ${grid}.`;
  }

  if (orderLabel !== "—") {
    const asDoc = docNumber
      ? `${orderLabel} (${docNumber}) as a ${kind}`
      : `${orderLabel} as a ${kind}`;
    return `You have ${verb} ${asDoc} from your ${grid}.`;
  }

  if (docNumber) {
    return `You have ${verb} ${docNumber} as a ${kind} from your ${grid}.`;
  }

  return `You have ${verb} a ${kind} from your ${grid}.`;
}

export function formatEventLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function eventActionBadgeTone(
  action: DocumentEventAction,
): "success" | "info" | "attention" | "new" {
  switch (action) {
    case "sent":
      return "success";
    case "printed":
      return "attention";
    case "uploaded":
      return "new";
    default:
      return "info";
  }
}
