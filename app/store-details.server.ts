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

export async function fetchShopCurrencyCode(admin: {
  graphql: (query: string) => Promise<Response>;
}): Promise<string> {
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
}

export async function fetchShopStoreDefaults(admin: {
  graphql: (query: string) => Promise<Response>;
}): Promise<StoreDetails> {
  try {
    const response = await admin.graphql(
      `#graphql
        query ShopOrganizationDetails {
          shop {
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

    const shop = payload.data?.shop ?? {};
    const fromShop = storeDetailsFromShop({
      ...shop,
      primaryDomainUrl: shop.primaryDomain?.url,
    });
    if (fromShop.address) return fromShop;

    const locationAddress = await fetchPrimaryLocationAddress(admin);
    if (!locationAddress) return fromShop;

    return {
      ...fromShop,
      address: storeDetailsFromShop({
        name: shop.name,
        email: shop.email,
        contactEmail: shop.contactEmail,
        primaryDomainUrl: shop.primaryDomain?.url,
        shopAddress: {
          company: shop.shopAddress?.company,
          ...locationAddress,
          phone: locationAddress.phone || shop.shopAddress?.phone,
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
