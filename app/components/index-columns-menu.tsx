import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  InlineStack,
  Icon,
  Popover,
  Text,
  UnstyledButton,
} from "@shopify/polaris";
import {
  DragHandleIcon,
  HideIcon,
  LayoutColumns3Icon,
  ViewIcon,
} from "@shopify/polaris-icons";

export type IndexColumnDef = {
  id: string;
  label: string;
  /** Always shown; hide toggle disabled. */
  locked?: boolean;
};

export type IndexColumnsState = {
  order: string[];
  hidden: string[];
};

export const SALES_ORDER_INDEX_COLUMNS: IndexColumnDef[] = [
  { id: "document", label: "Sales Order", locked: true },
  { id: "reference", label: "Reference" },
  { id: "date", label: "Date" },
  { id: "company", label: "Company" },
  { id: "customer", label: "Customer" },
  { id: "total", label: "Total" },
  { id: "paymentStatus", label: "Payment status" },
  { id: "fulfillmentStatus", label: "Fulfillment status" },
  { id: "invoiced", label: "Invoiced" },
  { id: "packingSlip", label: "Packing slip" },
  { id: "actions", label: "Actions", locked: true },
];

export const INVOICE_INDEX_COLUMNS: IndexColumnDef[] = [
  { id: "document", label: "Invoice", locked: true },
  { id: "reference", label: "Reference" },
  { id: "date", label: "Date" },
  { id: "company", label: "Company" },
  { id: "customer", label: "Customer" },
  { id: "total", label: "Amount" },
  { id: "balanceDue", label: "Balance Due" },
  { id: "paymentStatus", label: "Status" },
  { id: "creditNote", label: "Credit note" },
  { id: "actions", label: "Actions", locked: true },
];

export const CREDIT_NOTE_INDEX_COLUMNS: IndexColumnDef[] = [
  { id: "document", label: "Credit Note", locked: true },
  { id: "reference", label: "Reference" },
  { id: "date", label: "Date" },
  { id: "company", label: "Company" },
  { id: "customer", label: "Customer" },
  { id: "total", label: "Amount" },
  { id: "paymentStatus", label: "Status" },
  { id: "reason", label: "Reason" },
  { id: "actions", label: "Actions", locked: true },
];

function readStored(key: string, columns: IndexColumnDef[]): IndexColumnsState {
  const defaultOrder = columns.map((c) => c.id);
  if (typeof window === "undefined") {
    return { order: defaultOrder, hidden: [] };
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { order: defaultOrder, hidden: [] };
    const parsed = JSON.parse(raw) as IndexColumnsState;
    const known = new Set(columns.map((c) => c.id));
    const order = [
      ...parsed.order.filter((id) => known.has(id)),
      ...defaultOrder.filter((id) => !parsed.order.includes(id)),
    ];
    const hidden = (parsed.hidden || []).filter(
      (id) => known.has(id) && !columns.find((c) => c.id === id)?.locked,
    );
    return { order, hidden };
  } catch {
    return { order: defaultOrder, hidden: [] };
  }
}

function writeStored(key: string, state: IndexColumnsState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
}

export function useIndexColumns(
  storageKey: string,
  columns: IndexColumnDef[],
): {
  visibleColumns: IndexColumnDef[];
  menu: ReactNode;
} {
  const [state, setState] = useState<IndexColumnsState>(() =>
    readStored(storageKey, columns),
  );
  const [open, setOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setState(readStored(storageKey, columns));
  }, [storageKey, columns]);

  const persist = useCallback(
    (next: IndexColumnsState) => {
      setState(next);
      writeStored(storageKey, next);
    },
    [storageKey],
  );

  const toggleVisible = useCallback(
    (id: string) => {
      const col = columns.find((c) => c.id === id);
      if (!col || col.locked) return;
      const hidden = state.hidden.includes(id)
        ? state.hidden.filter((h) => h !== id)
        : [...state.hidden, id];
      const visibleCount = columns.filter(
        (c) => c.id !== "actions" && !hidden.includes(c.id),
      ).length;
      if (visibleCount === 0) return;
      persist({ ...state, hidden });
    },
    [columns, persist, state],
  );

  const moveColumn = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const order = [...state.order];
      const from = order.indexOf(fromId);
      const to = order.indexOf(toId);
      if (from < 0 || to < 0) return;
      order.splice(from, 1);
      order.splice(to, 0, fromId);
      persist({ ...state, order });
    },
    [persist, state],
  );

  const orderedColumns = state.order
    .map((id) => columns.find((c) => c.id === id))
    .filter((c): c is IndexColumnDef => Boolean(c));

  const visibleColumns = orderedColumns.filter(
    (c) => c.locked || !state.hidden.includes(c.id),
  );

  const menu = (
    <Popover
      active={open}
      autofocusTarget="first-node"
      preferredAlignment="right"
      onClose={() => setOpen(false)}
      activator={
        <Button
          icon={LayoutColumns3Icon}
          variant="tertiary"
          accessibilityLabel="Edit columns"
          onClick={() => setOpen((v) => !v)}
        />
      }
    >
      <Box minWidth="240px" paddingBlockStart="200">
        <Box paddingInline="300" paddingBlockEnd="150">
          <Text as="h3" variant="headingSm">
            Columns
          </Text>
        </Box>
        <div className="sales-orders-columns-list" role="list">
          {orderedColumns.map((col) => {
            const isHidden = !col.locked && state.hidden.includes(col.id);
            return (
              <div
                key={col.id}
                role="listitem"
                className={`sales-orders-columns-row${
                  isHidden ? " sales-orders-columns-row--hidden" : ""
                }${
                  draggingId === col.id
                    ? " sales-orders-columns-row--dragging"
                    : ""
                }`}
                draggable
                onDragStart={(event) => {
                  setDraggingId(col.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", col.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const fromId = event.dataTransfer.getData("text/plain");
                  moveColumn(fromId, col.id);
                  setDraggingId(null);
                }}
                onDragEnd={() => setDraggingId(null)}
              >
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                  gap="200"
                >
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <span className="sales-orders-columns-drag" aria-hidden>
                      <Icon source={DragHandleIcon} tone="subdued" />
                    </span>
                    <Text
                      as="span"
                      variant="bodyMd"
                      tone={isHidden ? "subdued" : undefined}
                    >
                      {col.label}
                    </Text>
                  </InlineStack>
                  <UnstyledButton
                    className="sales-orders-columns-visibility"
                    disabled={col.locked}
                    accessibilityLabel={
                      isHidden
                        ? `Show ${col.label} column`
                        : `Hide ${col.label} column`
                    }
                    onClick={() => toggleVisible(col.id)}
                  >
                    <Icon
                      source={isHidden ? HideIcon : ViewIcon}
                      tone={col.locked ? "subdued" : undefined}
                    />
                  </UnstyledButton>
                </InlineStack>
              </div>
            );
          })}
        </div>
      </Box>
    </Popover>
  );

  return { visibleColumns, menu };
}
