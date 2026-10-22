/**
 * Cloudflare Worker bindings. Secrets belong in the dashboard / `wrangler secret`,
 * not in wrangler.jsonc. Keep in sync with the vars listed there.
 */
interface Env {
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SCOPES: string;
  DATABASE_URL: string;
  DIRECT_URL: string;
  SHOP_CUSTOM_DOMAIN?: string;
  NODE_ENV?: string;
}
