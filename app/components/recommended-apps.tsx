import {
  Badge,
  BlockStack,
  Box,
  Card,
  Divider,
  Icon,
  InlineStack,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import { ExternalSmallIcon } from "@shopify/polaris-icons";

import offrefyLogo from "../assets/recommended/offrefy.png";
import approvefyLogo from "../assets/recommended/approvefy.png";
import { useAdminI18n } from "../admin-i18n-context";
import { settingsT } from "../admin-settings-i18n";
import "./recommended-apps.css";

export const RECOMMENDED_APPS = [
  {
    id: "approvefy",
    name: "Approvefy",
    taglineKey: "set.rec.approvefyTag" as const,
    badgeKey: "set.rec.approvefyBadge" as const,
    href: "https://apps.shopify.com/approvefy",
    logo: approvefyLogo,
  },
  {
    id: "offrefy",
    name: "Offrefy",
    taglineKey: "set.rec.offrefyTag" as const,
    badgeKey: "set.rec.offrefyBadge" as const,
    href: "https://apps.shopify.com/offrefy",
    logo: offrefyLogo,
  },
] as const;

type RecommendedAppsListProps = {
  /** Extra class on the outer wrapper (e.g. sticky sidebar). */
  className?: string;
  title?: string;
  subtitle?: string;
  /** When true, wrap in a Polaris Card (home). When false, bare stack (settings). */
  inCard?: boolean;
};

function RecommendedAppsList({
  className,
  title,
  subtitle,
  inCard = true,
}: RecommendedAppsListProps) {
  const { t, language } = useAdminI18n();
  const resolvedTitle = title ?? t("home.moreFromUs");
  const resolvedSubtitle =
    subtitle === undefined ? t("home.moreFromUsSubtitle") : subtitle;
  const body = (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant={inCard ? "headingMd" : "headingSm"}>
          {resolvedTitle}
        </Text>
        {resolvedSubtitle ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {resolvedSubtitle}
          </Text>
        ) : null}
      </BlockStack>

      <BlockStack gap="0">
        {RECOMMENDED_APPS.map((app, index) => (
          <Box key={app.id}>
            {index > 0 ? (
              <Box paddingBlockStart="300" paddingBlockEnd="300">
                <Divider />
              </Box>
            ) : null}
            <a
              className="recommended-app-row"
              href={app.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Thumbnail
                source={app.logo}
                alt=""
                size="small"
              />
              <div className="recommended-app-row__body">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {app.name}
                  </Text>
                  <Badge size="small" tone="info">
                    {settingsT(language, app.badgeKey)}
                  </Badge>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  {settingsT(language, app.taglineKey)}
                </Text>
              </div>
              <span className="recommended-app-row__action" aria-hidden>
                <Icon source={ExternalSmallIcon} tone="subdued" />
              </span>
            </a>
          </Box>
        ))}
      </BlockStack>
    </BlockStack>
  );

  if (inCard) {
    return (
      <div className={className}>
        <Card>{body}</Card>
      </div>
    );
  }

  return <div className={className}>{body}</div>;
}

export function RecommendedAppsCard() {
  return <RecommendedAppsList inCard />;
}

export function RecommendedAppsSidebar() {
  const { language } = useAdminI18n();
  return (
    <RecommendedAppsList
      className="settings-recommend-column"
      title={settingsT(language, "set.rec.title")}
      subtitle={settingsT(language, "set.rec.subtitle")}
      inCard={false}
    />
  );
}
