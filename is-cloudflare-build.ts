/**
 * Cloudflare Workers Builds / local CF scripts set this so Vite and React Router
 * use the Cloudflare plugin instead of the Vercel preset.
 * Shopify `app dev` and Vercel `npm run build` stay on the Node/Vercel path.
 */
export function isCloudflareBuild(): boolean {
  const event = process.env.npm_lifecycle_event ?? "";
  return (
    process.env.CLOUDFLARE === "1" ||
    process.env.WORKERS_CI === "1" ||
    event === "build:cloudflare" ||
    event === "deploy:cloudflare" ||
    event === "preview:cloudflare"
  );
}
