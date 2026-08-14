import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";

import {
  cachedClientLoader,
  createAppPageClientCache,
} from "../client-page-cache";
import { requireAdminAuth } from "../shopify-context.server";
import { loadStoreDetailsForShop } from "../shop-settings.server";

/**
 * Lightweight logo/name fetch for the template editor.
 * Keeps the edit-route loader JSON small so "Edit template" opens fast;
 * the editor hydrates brand after first paint.
 */
const storeBrandCache = createAppPageClientCache({ ttlMs: 300_000, max: 4 });

export async function clientLoader(args: ClientLoaderFunctionArgs) {
  return cachedClientLoader(storeBrandCache, args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const storeDetails = await loadStoreDetailsForShop(session.shop, admin, {
    includeLogo: true,
  });
  return {
    name: storeDetails.name,
    logoDataUrl: storeDetails.logoDataUrl ?? null,
    logoFileName: storeDetails.logoFileName ?? null,
  };
}
