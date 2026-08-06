import { authenticate } from "./shopify.server";

export type AdminAuthentication = Awaited<
  ReturnType<typeof authenticate.admin>
>;

/** Authenticate an embedded admin request (official Shopify pattern). */
export async function requireAdminAuth(request: Request) {
  return authenticate.admin(request);
}
