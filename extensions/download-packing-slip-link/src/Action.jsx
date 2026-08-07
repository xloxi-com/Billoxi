import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

const DOCUMENT_KIND = "packing-slip";
const HEADING = "Download packing slip";
const CONVERT_LABEL = "Convert to packing slip";
const FETCH_TIMEOUT_MS = 20000;

export default async () => {
  render(<Extension />, document.body);
};

function withHttpsDownloadUrl(downloadUrl, token) {
  const url = new URL(String(downloadUrl));
  if (url.protocol !== "https:") {
    url.protocol = "https:";
  }
  url.searchParams.set("token", token);
  return url.toString();
}

function Extension() {
  const { data, close, auth } = shopify;
  const [busy, setBusy] = useState(true);
  const [converting, setConverting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [needsConvert, setNeedsConvert] = useState(false);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [convertPath, setConvertPath] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    (async () => {
      try {
        const orderGid = data?.selected?.[0]?.id;
        if (!orderGid) throw new Error("No order selected");
        const orderId = String(orderGid).split("/").pop();
        if (!orderId) throw new Error("Invalid order id");

        const idToken = await auth.idToken();
        if (!idToken) throw new Error("Could not authenticate with Shopify");

        const qs = new URLSearchParams({
          orderId,
          document: DOCUMENT_KIND,
        });
        const res = await fetch(`/extension-document-pdf?${qs}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` },
          signal: ac.signal,
        });

        let payload = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }

        if (!res.ok || !payload?.ok || !payload?.downloadUrl) {
          throw new Error(payload?.error || `Download failed (${res.status})`);
        }

        if (cancelled) return;

        setToken(idToken);
        setDownloadUrl(withHttpsDownloadUrl(payload.downloadUrl, idToken));

        if (payload.needsConvert) {
          setNeedsConvert(true);
          setConvertPath(
            String(
              payload.convertPath ||
                `/extension-document-convert?${qs.toString()}`,
            ),
          );
        } else {
          setNeedsConvert(false);
          setConvertPath("");
        }

        setReady(true);
        setBusy(false);
      } catch (err) {
        if (cancelled) return;
        const message =
          err?.name === "AbortError"
            ? "Timed out — try again"
            : err instanceof Error
              ? err.message
              : "Something went wrong";
        setError(message);
        setBusy(false);
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [auth, data?.selected]);

  const handleConvert = async () => {
    if (!convertPath || !token || converting) return;
    setConverting(true);
    setError("");
    try {
      const res = await fetch(convertPath, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        // ignore
      }
      if (!res.ok || !payload?.ok || !payload?.downloadUrl) {
        throw new Error(payload?.error || `Convert failed (${res.status})`);
      }
      setDownloadUrl(withHttpsDownloadUrl(payload.downloadUrl, token));
      setNeedsConvert(false);
      setConvertPath("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Convert failed");
    } finally {
      setConverting(false);
    }
  };

  const handleSave = () => {
    if (!downloadUrl || saving || needsConvert) return;
    setSaving(true);
    setError("");
    open(downloadUrl, "_blank", "noopener,noreferrer");
    setSaving(false);
    setSaved(true);
  };

  return (
    <s-admin-action heading={HEADING} loading={busy && !error}>
      {ready && needsConvert ? (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={handleConvert}
          disabled={converting}
        >
          {converting ? "Converting…" : CONVERT_LABEL}
        </s-button>
      ) : ready ? (
        <s-button
          slot="primary-action"
          variant="primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Opening…" : "Save PDF"}
        </s-button>
      ) : (
        <s-button slot="primary-action" onClick={() => close()} disabled={busy}>
          Close
        </s-button>
      )}
      <s-button slot="secondary-actions" onClick={() => close()}>
        Cancel
      </s-button>
      {error ? (
        <s-banner heading="Could not continue" tone="critical">
          {error}
        </s-banner>
      ) : busy ? (
        <s-text>Checking packing slip…</s-text>
      ) : needsConvert ? (
        <s-banner heading="Not a packing slip yet" tone="warning">
          Convert this order to a packing slip first, then download the PDF
          (same as in Billoxi).
        </s-banner>
      ) : saved ? (
        <s-banner heading="Downloading" tone="success">
          PDF is generating — check the new tab / downloads folder.
        </s-banner>
      ) : (
        <s-text>
          Tap Save PDF to download (same layout as in the Billoxi app).
        </s-text>
      )}
    </s-admin-action>
  );
}
