import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

const DOCUMENT_KIND = "draft";
const HEADING = "Print draft";
const FETCH_TIMEOUT_MS = 25000;

export default async () => {
  render(<Extension />, document.body);
};

function withHttpsPrintUrl(printUrl) {
  const url = new URL(String(printUrl));
  if (url.protocol !== "https:") {
    url.protocol = "https:";
  }
  return url.toString();
}

function Extension() {
  const { data, close, auth } = shopify;
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const [readyUrl, setReadyUrl] = useState("");
  const prepRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    prepRef.current = (async () => {
      const orderGid = data?.selected?.[0]?.id;
      if (!orderGid) throw new Error("No draft order selected");
      const orderId = String(orderGid).split("/").pop();
      if (!orderId) throw new Error("Invalid draft order id");

      const idToken = await auth.idToken();
      if (!idToken) throw new Error("Could not authenticate with Shopify");

      const qs = new URLSearchParams({
        prep: "1",
        autoprint: "1",
        orderId,
        document: DOCUMENT_KIND,
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
        throw new Error(payload?.error || `Print failed (${res.status})`);
      }

      const url = withHttpsPrintUrl(payload.src);

      if (!cancelled) {
        setReadyUrl(url);
        setChecking(false);
      }
      return { url };
    })().catch((err) => {
      if (cancelled || err?.name === "AbortError") return null;
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setChecking(false);
      }
      return null;
    });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [auth, data?.selected]);

  const handlePrimary = async () => {
    if (working || checking) return;
    setWorking(true);
    setError("");
    setOpened(false);

    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    try {
      let prep = { url: readyUrl };
      if (!prep.url && prepRef.current) {
        const loaded = await prepRef.current;
        if (!loaded) throw new Error("Print failed");
        prep = loaded;
      }
      if (!prep.url) throw new Error("Print URL missing");

      open(prep.url, "_blank", "noopener,noreferrer");
      setOpened(true);
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Timed out — try again"
          : err instanceof Error
            ? err.message
            : "Print failed";
      setError(message);
    } finally {
      window.clearTimeout(timer);
      setWorking(false);
    }
  };

  let primaryLabel = "…";
  if (working) {
    primaryLabel = "Opening…";
  } else if (!checking && !error) {
    primaryLabel = HEADING;
  }

  return (
    <s-admin-action heading={HEADING} loading={checking && !error}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handlePrimary}
        disabled={working || checking || Boolean(error)}
      >
        {primaryLabel}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => close()}>
        Cancel
      </s-button>
      {error ? (
        <s-banner heading="Could not continue" tone="critical">
          {error}
        </s-banner>
      ) : checking ? (
        <s-text>Building print preview…</s-text>
      ) : opened ? (
        <s-banner heading="Print dialog" tone="success">
          Print preview opened — use the browser print dialog.
        </s-banner>
      ) : working ? (
        <s-text>Opening print…</s-text>
      ) : (
        <s-banner heading="Print draft" tone="info">
          Tap to open this draft order for printing.
        </s-banner>
      )}
    </s-admin-action>
  );
}
