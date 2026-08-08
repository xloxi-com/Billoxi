import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { data, auth } = shopify;
  const [src, setSrc] = useState(null);
  const [printSalesOrder, setPrintSalesOrder] = useState(true);
  const [printInvoice, setPrintInvoice] = useState(false);
  const [printPackingSlip, setPrintPackingSlip] = useState(false);
  const [invoiceNeedsConvert, setInvoiceNeedsConvert] = useState(false);
  const [packingNeedsConvert, setPackingNeedsConvert] = useState(false);
  const [statusReady, setStatusReady] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");

  const orderGid = data?.selected?.[0]?.id;
  const orderId = orderGid ? String(orderGid).split("/").pop() : "";

  // Lightweight convert flags only — do not block sales-order preview.
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      if (!orderId) {
        setStatusReady(true);
        return;
      }
      const idToken = await auth.idToken();
      if (!idToken) throw new Error("Could not authenticate with Shopify");

      const checkKind = async (document) => {
        const qs = new URLSearchParams({
          orderId,
          document,
          statusOnly: "1",
        });
        const res = await fetch(`/extension-document-pdf?${qs}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
            Accept: "application/json",
          },
          signal: ac.signal,
        });
        let payload = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }
        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || `Check failed (${res.status})`);
        }
        return Boolean(payload.needsConvert);
      };

      const [invoiceConvert, packingConvert] = await Promise.all([
        checkKind("invoice"),
        checkKind("packing-slip"),
      ]);

      if (!cancelled) {
        setInvoiceNeedsConvert(invoiceConvert);
        setPackingNeedsConvert(packingConvert);
        setStatusReady(true);
      }
    })().catch((err) => {
      if (cancelled || err?.name === "AbortError") return;
      if (!cancelled) {
        // Still allow sales-order print if status check fails.
        setError(err instanceof Error ? err.message : "Status check failed");
        setStatusReady(true);
      }
    });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [auth, orderId]);

  // Prepare preview as soon as selected docs are printable.
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    (async () => {
      if (!orderId) {
        setSrc(null);
        setPreparing(false);
        return;
      }

      const docs = [];
      if (printSalesOrder) docs.push("sales-order");
      // Wait for status before including invoice/packing (may need convert).
      if (printInvoice) {
        if (!statusReady) {
          setPreparing(true);
          return;
        }
        if (!invoiceNeedsConvert) docs.push("invoice");
      }
      if (printPackingSlip) {
        if (!statusReady) {
          setPreparing(true);
          return;
        }
        if (!packingNeedsConvert) docs.push("packing-slip");
      }

      if (!docs.length) {
        setSrc(null);
        setPreparing(false);
        return;
      }

      setPreparing(true);
      setError("");

      const idToken = await auth.idToken();
      if (!idToken) throw new Error("Could not authenticate with Shopify");

      const qs = new URLSearchParams({
        prep: "1",
        orderId,
        document: docs.join(","),
      });
      const res = await fetch(`/extension-document-print?${qs}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          Accept: "application/json",
        },
        signal: ac.signal,
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        // ignore
      }
      if (!res.ok || !payload?.ok || !payload?.src) {
        throw new Error(payload?.error || `Preview failed (${res.status})`);
      }

      if (!cancelled) {
        setSrc(String(payload.src));
        setPreparing(false);
      }
    })().catch((err) => {
      if (cancelled || err?.name === "AbortError") return;
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Preview failed");
        setSrc(null);
        setPreparing(false);
      }
    });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    auth,
    orderId,
    statusReady,
    printSalesOrder,
    printInvoice,
    printPackingSlip,
    invoiceNeedsConvert,
    packingNeedsConvert,
  ]);

  const convertSelected = async () => {
    if (converting || !orderId) return;
    const kinds = [];
    if (printInvoice && invoiceNeedsConvert) kinds.push("invoice");
    if (printPackingSlip && packingNeedsConvert) kinds.push("packing-slip");
    if (!kinds.length) return;

    setConverting(true);
    setError("");
    try {
      const idToken = await auth.idToken();
      if (!idToken) throw new Error("Could not authenticate with Shopify");

      for (const document of kinds) {
        const qs = new URLSearchParams({ orderId, document });
        const res = await fetch(`/extension-document-convert?${qs}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
            Accept: "application/json",
          },
        });
        let payload = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }
        if (!res.ok || !payload?.ok) {
          throw new Error(
            payload?.error || `Could not convert ${document} (${res.status})`,
          );
        }
      }

      if (kinds.includes("invoice")) setInvoiceNeedsConvert(false);
      if (kinds.includes("packing-slip")) setPackingNeedsConvert(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Convert failed");
    } finally {
      setConverting(false);
    }
  };

  const needsConvertForSelection =
    statusReady &&
    ((printInvoice && invoiceNeedsConvert) ||
      (printPackingSlip && packingNeedsConvert));

  const waitingStatusForExtraDocs =
    (printInvoice || printPackingSlip) && !statusReady;

  return (
    <s-admin-print-action src={src}>
      <s-stack direction="block" gap="base">
        <s-text type="strong">Documents</s-text>
        {error ? (
          <s-banner heading="Could not continue" tone="critical">
            {error}
          </s-banner>
        ) : null}
        <s-checkbox
          name="sales-order"
          checked={printSalesOrder}
          label="Sales order"
          onChange={(event) => {
            setPrintSalesOrder(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        />
        <s-checkbox
          name="invoice"
          checked={printInvoice}
          label={
            statusReady && invoiceNeedsConvert
              ? "Invoice (needs convert)"
              : "Invoice"
          }
          onChange={(event) => {
            setPrintInvoice(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        />
        <s-checkbox
          name="packing-slip"
          checked={printPackingSlip}
          label={
            statusReady && packingNeedsConvert
              ? "Packing slip (needs convert)"
              : "Packing slip"
          }
          onChange={(event) => {
            setPrintPackingSlip(
              /** @type {HTMLInputElement} */ (event.target).checked,
            );
          }}
        />
        {needsConvertForSelection ? (
          <>
            <s-banner heading="Convert in Billoxi" tone="warning">
              Selected invoice/packing slip is not created yet. Convert first,
              then print.
            </s-banner>
            <s-button
              variant="primary"
              onClick={convertSelected}
              disabled={converting}
            >
              {converting ? "Converting…" : "Convert & prepare print"}
            </s-button>
          </>
        ) : preparing || waitingStatusForExtraDocs ? (
          <s-text>Building preview…</s-text>
        ) : !src ? (
          <s-text>Select at least one document to print.</s-text>
        ) : (
          <s-text>Preview ready — click Continue to print.</s-text>
        )}
      </s-stack>
    </s-admin-print-action>
  );
}
