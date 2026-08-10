import type { HeadersFunction } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  renderEmbeddedRouteError,
  renderNotFoundPage,
} from "../embedded-route-error";

/** Catch-all for unknown `/app/*` paths (e.g. `/app/sds`). */
export default function AppCatchAll() {
  return renderNotFoundPage();
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:app-catchall-reload");
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
