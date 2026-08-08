import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

const DOCUMENT_KIND = "invoice";
const HEADING_DOWNLOAD = "Invoice download";
const HEADING_CONVERT = "Convert to invoice & download";
const FETCH_TIMEOUT_MS = 25000;

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

function resolveNeedsConvert(payload) {
  if (typeof payload?.needsConvert === "boolean") {
    return payload.needsConvert;
  }
  return Boolean(payload?.convertPath);
}

function Extension() {
  const { data, close, auth } = shopify;
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [didConvert, setDidConvert] = useState(false);
  const [readyUrl, setReadyUrl] = useState("");
  const [needsConvert, setNeedsConvert] = useState(null);
  const [convertPath, setConvertPath] = useState("");
  const [token, setToken] = useState("");
  const prepRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    prepRef.current = (async () => {
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
      if (!res.ok || !payload?.ok || !payload?.downloadUrl) {
        throw new Error(payload?.error || `Download failed (${res.status})`);
      }

      const url = withHttpsDownloadUrl(payload.downloadUrl, idToken);
      const convertNeeded = resolveNeedsConvert(payload);
      const path =
        payload.convertPath ||
        `/extension-document-convert?${qs.toString()}`;

      if (!cancelled) {
        setToken(idToken);
        setReadyUrl(url);
        setNeedsConvert(convertNeeded);
        setConvertPath(String(path));
        setChecking(false);
      }
      return {
        url,
        token: idToken,
        needsConvert: convertNeeded,
        convertPath: path,
      };
    })().catch((err) => {
      if (cancelled || err?.name === "AbortError") return null;
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setChecking(false);
        setNeedsConvert(null);
      }
      return null;
    });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [auth, data?.selected]);

  const handlePrimary = async () => {
    if (working || checking || needsConvert === null) return;
    setWorking(true);
    setError("");
    setSaved(false);
    setDidConvert(false);

    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    try {
      let prep = {
        url: readyUrl,
        token,
        needsConvert: Boolean(needsConvert),
        convertPath,
      };
      if ((!prep.url || !prep.token) && prepRef.current) {
        const loaded = await prepRef.current;
        if (!loaded) throw new Error("Download failed");
        prep = loaded;
      }
      if (!prep.url || !prep.token) throw new Error("Download URL missing");

      let url = prep.url;
      if (prep.needsConvert) {
        const res = await fetch(prep.convertPath, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${prep.token}`,
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
        if (!res.ok || !payload?.ok || !payload?.downloadUrl) {
          throw new Error(payload?.error || `Convert failed (${res.status})`);
        }
        url = withHttpsDownloadUrl(payload.downloadUrl, prep.token);
        setNeedsConvert(false);
        setDidConvert(true);
        setReadyUrl(url);
      }

      open(url, "_blank", "noopener,noreferrer");
      setSaved(true);
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Timed out — try again"
          : err instanceof Error
            ? err.message
            : "Download failed";
      setError(message);
    } finally {
      window.clearTimeout(timer);
      setWorking(false);
    }
  };

  const showConvert = needsConvert === true;
  const showDownload = needsConvert === false;
  const heading = showConvert
    ? HEADING_CONVERT
    : showDownload
      ? HEADING_DOWNLOAD
      : "Download invoice";

  let primaryLabel = "…";
  if (working) {
    primaryLabel = showConvert || didConvert ? "Converting…" : "Opening…";
  } else if (showConvert) {
    primaryLabel = HEADING_CONVERT;
  } else if (showDownload) {
    primaryLabel = HEADING_DOWNLOAD;
  }

  return (
    <s-admin-action heading={heading} loading={checking && !error}>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handlePrimary}
        disabled={working || checking || needsConvert === null}
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
      ) : checking || needsConvert === null ? (
        <s-text>Checking if this order is an invoice…</s-text>
      ) : saved ? (
        <s-banner
          heading={didConvert ? "Converted in Billoxi" : "Downloading"}
          tone="success"
        >
          {didConvert
            ? "Invoice created in Billoxi. PDF downloading — check downloads."
            : "PDF downloading — check your downloads folder."}
        </s-banner>
      ) : showConvert ? (
        <s-banner heading="Convert to invoice & download" tone="warning">
          This order is not an invoice yet. Tap the button to convert it in
          Billoxi, then download the PDF.
        </s-banner>
      ) : working ? (
        <s-text>Opening download…</s-text>
      ) : (
        <s-banner heading="Invoice download" tone="info">
          This order is already an invoice. Tap to download the PDF.
        </s-banner>
      )}
    </s-admin-action>
  );
}
