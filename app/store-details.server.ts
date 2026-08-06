import {
  mergeStoreDetails,
  normalizeStoreDetails,
  storeDetailsFromShop,
  type StoreDetails,
  emptyStoreDetails,
} from "./store-details";

export type { StoreDetails };
export {
  emptyStoreDetails,
  mergeStoreDetails,
  normalizeStoreDetails,
  storeDetailsFromShop,
};

type ShopAddress = {
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
};

type AdminGraphql = {
  graphql: (query: string) => Promise<Response>;
};

type CacheEntry<T> = { expires: number; value: T };

/** Shop org defaults change rarely — avoid refetching on every document/template load. */
const SHOP_DEFAULTS_TTL_MS = 90_000;
const storeDefaultsCache = new Map<string, CacheEntry<StoreDetails>>();
const currencyCache = new Map<string, CacheEntry<string>>();
const inFlightStoreDefaults = new Map<string, Promise<StoreDetails>>();
const inFlightCurrency = new Map<string, Promise<string>>();

function readCache<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
) {
  map.set(key, { expires: Date.now() + SHOP_DEFAULTS_TTL_MS, value });
}

export async function fetchShopCurrencyCode(
  admin: AdminGraphql,
  shop?: string,
): Promise<string> {
  if (shop) {
    const cached = readCache(currencyCache, shop);
    if (cached) return cached;
    const pending = inFlightCurrency.get(shop);
    if (pending) return pending;
  }

  const load = (async () => {
    try {
      const response = await admin.graphql(
        `#graphql
          query ShopCurrency {
            shop {
              currencyCode
            }
          }`,
      );
      const payload = (await response.json()) as {
        data?: { shop?: { currencyCode?: string | null } };
        errors?: Array<{ message: string }>;
      };
      if (payload.errors?.length) {
        console.error("Shop currency GraphQL errors:", payload.errors);
      }
      const code = payload.data?.shop?.currencyCode?.trim().toUpperCase();
      return code || "USD";
    } catch (error) {
      console.error("Failed to load shop currency:", error);
      return "USD";
    }
  })();

  if (shop) {
    inFlightCurrency.set(shop, load);
    try {
      const code = await load;
      writeCache(currencyCache, shop, code);
      return code;
    } finally {
      inFlightCurrency.delete(shop);
    }
  }

  return load;
}

export async function fetchShopStoreDefaults(
  admin: AdminGraphql,
  shop?: string,
): Promise<StoreDetails> {
  if (shop) {
    const cached = readCache(storeDefaultsCache, shop);
    if (cached) return cached;
    const pending = inFlightStoreDefaults.get(shop);
    if (pending) return pending;
  }

  const load = (async () => {
    try {
      const response = await admin.graphql(
        `#graphql
          query ShopOrganizationDetails {
            shop {
              currencyCode
              name
              email
              contactEmail
              primaryDomain {
                url
              }
              shopAddress {
                company
                address1
                address2
                city
                province
                zip
                country
                phone
              }
            }
          }`,
      );
      const payload = (await response.json()) as {
        data?: {
          shop?: {
            currencyCode?: string | null;
            name?: string | null;
            email?: string | null;
            contactEmail?: string | null;
            primaryDomain?: { url?: string | null } | null;
            shopAddress?: ShopAddress | null;
          };
        };
        errors?: Array<{ message: string }>;
      };

      if (payload.errors?.length) {
        console.error("Shop store details GraphQL errors:", payload.errors);
      }

      const shopNode = payload.data?.shop ?? {};
      if (shop) {
        const code = shopNode.currencyCode?.trim().toUpperCase();
        if (code) writeCache(currencyCache, shop, code);
      }

      const fromShop = storeDetailsFromShop({
        ...shopNode,
        primaryDomainUrl: shopNode.primaryDomain?.url,
      });
      if (fromShop.address) return fromShop;

      const locationAddress = await fetchPrimaryLocationAddress(admin);
      if (!locationAddress) return fromShop;

      return {
        ...fromShop,
        address: storeDetailsFromShop({
          name: shopNode.name,
          email: shopNode.email,
          contactEmail: shopNode.contactEmail,
          primaryDomainUrl: shopNode.primaryDomain?.url,
          shopAddress: {
            company: shopNode.shopAddress?.company,
            ...locationAddress,
            phone: locationAddress.phone || shopNode.shopAddress?.phone,
          },
        }).address,
        phone:
          fromShop.phone ||
          (typeof locationAddress.phone === "string"
            ? locationAddress.phone.trim()
            : ""),
      };
    } catch (error) {
      console.error("Failed to load shop store details:", error);
      return { ...emptyStoreDetails };
    }
  })();

  if (shop) {
    inFlightStoreDefaults.set(shop, load);
    try {
      const value = await load;
      writeCache(storeDefaultsCache, shop, value);
      return value;
    } finally {
      inFlightStoreDefaults.delete(shop);
    }
  }

  return load;
}

async function fetchPrimaryLocationAddress(admin: {
  graphql: (query: string) => Promise<Response>;
}): Promise<ShopAddress | null> {
  try {
    const response = await admin.graphql(
      `#graphql
        query ShopLocationAddress {
          locations(first: 5, includeLegacy: true) {
            nodes {
              isActive
              shipsInventory
              address {
                address1
                address2
                city
                province
                zip
                country
                phone
              }
            }
          }
        }`,
    );
    const payload = (await response.json()) as {
      data?: {
        locations?: {
          nodes?: Array<{
            isActive?: boolean | null;
            shipsInventory?: boolean | null;
            address?: ShopAddress | null;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      console.error("Shop location address GraphQL errors:", payload.errors);
      return null;
    }

    const locations = payload.data?.locations?.nodes ?? [];
    const preferred =
      locations.find(
        (location) => location.shipsInventory && location.address?.address1,
      ) ||
      locations.find(
        (location) => location.isActive && location.address?.address1,
      ) ||
      locations.find((location) => location.address?.address1);

    return preferred?.address ?? null;
  } catch (error) {
    console.error("Failed to load shop location address:", error);
    return null;
  }
}
