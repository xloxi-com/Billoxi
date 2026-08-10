import { renderNotFoundPage } from "../embedded-route-error";

/** Root catch-all for unknown paths outside `/app/*`. */
export default function RootCatchAll() {
  return renderNotFoundPage();
}
