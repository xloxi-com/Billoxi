import { useEffect } from "react";

const TAWK_SRC = "https://embed.tawk.to/6a7cc5f65f93201d47deecbc/1jvrmh77v";

declare global {
  interface Window {
    Tawk_API?: Record<string, unknown>;
    Tawk_LoadStart?: Date;
  }
}

/**
 * Loads Tawk.to live chat (bottom-right bubble) once per app session.
 */
export function TawkChat() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("tawk-to-script")) return;

    window.Tawk_API = window.Tawk_API || {};
    window.Tawk_LoadStart = new Date();

    const script = document.createElement("script");
    script.id = "tawk-to-script";
    script.async = true;
    script.src = TAWK_SRC;
    script.charset = "UTF-8";
    script.setAttribute("crossorigin", "*");

    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(script, first);
  }, []);

  return null;
}
