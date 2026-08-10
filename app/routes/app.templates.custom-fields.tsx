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

async function fetchAllProductMetafieldDefinitions(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<MetafieldDefinitionNode[]> {
  const nodes: MetafieldDefinitionNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query ProductCustomFieldSources($cursor: String) {
          productMetafields: metafieldDefinitions(
            first: 100
            after: $cursor
            ownerType: PRODUCT
          ) {
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
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      { variables: { cursor } },
    );
    const payload = (await response.json()) as {
      data?: {
        productMetafields?: {
          nodes?: MetafieldDefinitionNode[];
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      console.error("Custom field sources GraphQL errors:", payload.errors);
      break;
    }

    const page = payload.data?.productMetafields;
    nodes.push(...(page?.nodes ?? []));
    hasNextPage = Boolean(page?.pageInfo?.hasNextPage);
    cursor = page?.pageInfo?.endCursor ?? null;
    if (!hasNextPage || !cursor) break;
    // Safety cap — unlikely a shop needs more than this in the picker.
    if (nodes.length >= 500) break;
  }

  return nodes;
}

async function fetchCustomFieldSources(
  shop: string,
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  options?: { bypassCache?: boolean },
): Promise<CustomFieldSource[]> {
  if (!options?.bypassCache) {
    const cached = sourcesCache.get(shop);
    if (cached && cached.expires > Date.now()) return cached.value;
  }

  try {
    const nodes = await fetchAllProductMetafieldDefinitions(admin);
    const value = nodes
      .filter(isMerchantCreatedMetafield)
      .map((node) => ({
        id: node.id,
        kind: "metafield" as const,
        name: node.name,
        typeName: node.type?.name || "metafield",
        namespace: node.namespace,
        key: node.key,
        ownerType: node.ownerType,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    sourcesCache.set(shop, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    console.error("Failed to load custom field sources:", error);
    return [];
  }
}

/** Lazy endpoint — only fetch when the editor explicitly loads this URL. */
export function shouldRevalidate() {
  // Parent template saves/revalidations must not auto-refresh this list.
  return false;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await requireAdminAuth(request);
  const url = new URL(request.url);
  const bypassCache =
    url.searchParams.get("fresh") === "1" ||
    url.searchParams.get("refresh") === "1";
  const sources = await fetchCustomFieldSources(session.shop, admin, {
    bypassCache,
  });
  return Response.json({ sources });
}
