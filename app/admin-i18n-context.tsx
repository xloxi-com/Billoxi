import { createContext, useContext } from "react";
import {
  adminT,
  DEFAULT_ADMIN_UI_LANGUAGE,
  type AdminMessageKey,
  type AdminUiLanguage,
} from "./admin-i18n";

export type AdminI18nContextValue = {
  language: AdminUiLanguage;
  t: (key: AdminMessageKey) => string;
};

export const AdminI18nContext = createContext<AdminI18nContextValue>({
  language: DEFAULT_ADMIN_UI_LANGUAGE,
  t: (key) => adminT(DEFAULT_ADMIN_UI_LANGUAGE, key),
});

export function useAdminI18n() {
  return useContext(AdminI18nContext);
}
