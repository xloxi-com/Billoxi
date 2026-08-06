import { authenticate } from "./shopify.server";

export type AdminAuthentication = Awaited<
  ReturnType<typeof authenticate.admin>
>;

/** Per-request memo so nested loaders share one authenticate.admin call. */
const adminAuthByRequest = new WeakMap<Request, Promise<AdminAuthentication>>();

/** Authenticate an embedded admin request (official Shopify pattern). */
export async function requireAdminAuth(request: Request) {
  let pending = adminAuthByRequest.get(request);
  if (!pending) {
    pending = authenticate.admin(request);
    adminAuthByRequest.set(request, pending);
  }
  return pending;
}
