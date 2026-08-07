import type { LoaderFunctionArgs } from "react-router";

import { requireAdminAuth } from "../shopify-context.server";

type MetafieldDefinitionNode = {
  id: string;
  name: string;
  namespace: string;
  key: string;
  ownerType: string;
  type?: { name?: string | null } | null;
};

export type CustomFieldSource = {
  id: string;
  kind: "metafield";
  name: string;
  typeName: string;
  namespace: string;
  key: string;
  ownerType: string;
};

const CACHE_TTL_MS = 120_000;
const sourcesCache = new Map<
  string,
  { expires: number; value: CustomFieldSource[] }
>();

function isMerchantCreatedMetafield(node: MetafieldDefinitionNode) {
  const namespace = node.namespace.trim().toLowerCase();
  if (
    namespace === "app" ||
    namespace === "$app" ||
    namespace.startsWith("app--") ||
    namespace.startsWith("$app:") ||
    namespace.startsWith("$app.") ||
    namespace.startsWith("shopify")
  ) {
    return false;
  }
  if (node.key === "demo_info" || node.name === "Demo Source Info") return false;
  return true;
}

async function fetchCustomFieldSources(
  shop: string,
  admin: { graphql: (query: string) => Promise<Response> },
): Promise<CustomFieldSource[]> {
  const cached = sourcesCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const response = await admin.graphql(
      `#graphql
        query ProductCustomFieldSources {
          productMetafields: metafieldDefinitions(first: 50, ownerType: PRODUCT) {
            nodes {
              id
              name
              namespace
              key
              ownerType
              type {
                name
              }
            }
          }
        }`,
    );
    const payload = (await response.json()) as {
      data?: {
        productMetafields?: { nodes?: MetafieldDefinitionNode[] };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      console.error("Custom field sources GraphQL errors:", payload.errors);
    }

    const value = (payload.data?.productMetafields?.nodes ?? [])
      .filter(isMerchantCreatedMetafield)
      .map((node) => ({
        id: node.id,
        kind: "metafield" as const,
        name: node.name,
        typeName: node.type?.name || "metafield",
        namespace: node.namespace,
        key: node.key,
        ownerType: node.ownerType,
      }));

    sourcesCache.set(shop, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    console.error("Failed to load custom field sources:", error);
    return [];
  }
}

/** Lazy endpoint — template editor loads this after first paint. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const sources = await fetchCustomFieldSources(session.shop, admin);
  return Response.json({ sources });
}
