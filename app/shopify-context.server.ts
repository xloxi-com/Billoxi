import { createContext } from "react-router";

import { authenticate } from "./shopify.server";

export type AdminAuthentication = Awaited<
  ReturnType<typeof authenticate.admin>
>;

export const adminAuthenticationContext = createContext<AdminAuthentication>();
