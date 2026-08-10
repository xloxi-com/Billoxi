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
import "./recommended-apps.css";

export const RECOMMENDED_APPS = [
  {
    id: "approvefy",
    name: "Approvefy",
    tagline: "B2B registration & approval",
    href: "https://apps.shopify.com/approvefy",
    badge: "From $4.99/mo",
    logo: approvefyLogo,
  },
  {
    id: "offrefy",
    name: "Offrefy",
    tagline: "Quantity breaks at checkout",
    href: "https://apps.shopify.com/offrefy",
    badge: "Free plan",
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
  title = "More from us",
  subtitle = "Apps that work well alongside Billoxi.",
  inCard = true,
}: RecommendedAppsListProps) {
  const body = (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Text as="h2" variant={inCard ? "headingMd" : "headingSm"}>
          {title}
        </Text>
        {subtitle ? (
          <Text as="p" tone="subdued" variant="bodySm">
            {subtitle}
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
                    {app.badge}
                  </Badge>
                </InlineStack>
                <Text as="p" tone="subdued" variant="bodySm">
                  {app.tagline}
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
  return (
    <RecommendedAppsList
      className="settings-recommend-column"
      title="More from XLOXI"
      subtitle="Apps that pair well with Billoxi."
      inCard={false}
    />
  );
}
