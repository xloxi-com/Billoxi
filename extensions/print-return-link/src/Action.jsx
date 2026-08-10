import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

const DOCUMENT_KIND = "return";
const HEADING = "Print return";
const HEADING_CONVERT = "Convert to return & print";
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

      const statusQs = new URLSearchParams({
        orderId,
        document: DOCUMENT_KIND,
        statusOnly: "1",
      });
      const statusRes = await fetch(`/extension-document-pdf?${statusQs}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${idToken}`,
          Accept: "application/json",
        },
        signal: ac.signal,
      });
      let statusPayload = null;
      try {
        statusPayload = await statusRes.json();
      } catch {
        // ignore
      }
      if (!statusRes.ok || !statusPayload?.ok) {
        throw new Error(
          statusPayload?.error || `Status check failed (${statusRes.status})`,
        );
      }

      const convertNeeded = Boolean(statusPayload.needsConvert);
      const path =
        statusPayload.convertPath ||
        `/extension-document-convert?${new URLSearchParams({
          orderId,
          document: DOCUMENT_KIND,
        })}`;

      let url = "";
      if (!convertNeeded) {
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
        url = withHttpsPrintUrl(payload.src);
      }

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
        orderId,
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
    setOpened(false);
    setDidConvert(false);

    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

    try {
      let prep = {
        url: readyUrl,
        token,
        needsConvert: Boolean(needsConvert),
        convertPath,
        orderId: "",
      };
      if (prepRef.current) {
        const loaded = await prepRef.current;
        if (!loaded) throw new Error("Print failed");
        prep = { ...prep, ...loaded };
      }
      if (!prep.token) throw new Error("Could not authenticate with Shopify");

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
        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || `Convert failed (${res.status})`);
        }
        setNeedsConvert(false);
        setDidConvert(true);
      }

      let url = prep.url;
      if (!url || prep.needsConvert) {
        const orderId =
          prep.orderId ||
          String(data?.selected?.[0]?.id || "")
            .split("/")
            .pop() ||
          "";
        const qs = new URLSearchParams({
          prep: "1",
          autoprint: "1",
          orderId,
          document: DOCUMENT_KIND,
        });
        const res = await fetch(`/extension-document-print?${qs}`, {
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
        if (!res.ok || !payload?.ok || !payload?.src) {
          throw new Error(payload?.error || `Print failed (${res.status})`);
        }
        url = withHttpsPrintUrl(payload.src);
        setReadyUrl(url);
      }

      open(url, "_blank", "noopener,noreferrer");
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

  const showConvert = needsConvert === true;
  const heading = showConvert ? HEADING_CONVERT : HEADING;

  let primaryLabel = "…";
  if (working) {
    primaryLabel = showConvert || didConvert ? "Converting…" : "Opening…";
  } else if (showConvert) {
    primaryLabel = HEADING_CONVERT;
  } else if (!checking && !error) {
    primaryLabel = HEADING;
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
        <s-text>Building print preview…</s-text>
      ) : opened ? (
        <s-banner heading="Print dialog" tone="success">
          {didConvert
            ? "Return created in Billoxi. Print preview opened."
            : "Print preview opened — use the browser print dialog."}
        </s-banner>
      ) : showConvert ? (
        <s-banner heading="Convert to return & print" tone="warning">
          This order is not a return document yet. Tap to convert it in Billoxi,
          then print.
        </s-banner>
      ) : working ? (
        <s-text>Opening print…</s-text>
      ) : (
        <s-banner heading="Print return" tone="info">
          Tap to open this return document for printing.
        </s-banner>
      )}
    </s-admin-action>
  );
}
