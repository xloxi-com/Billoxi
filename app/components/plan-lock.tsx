import { useCallback, useState, type ReactNode, type SVGProps } from "react";
import { useNavigate } from "react-router";
import {
  Banner,
  BlockStack,
  Box,
  Icon,
  InlineStack,
  Modal,
  Text,
  Tooltip,
} from "@shopify/polaris";

import {
  getCurrentPlanId,
  planBadgeLabel,
  planHasCapability,
  requiredPlanFor,
  upgradeMessage,
  type PlanCapability,
} from "../plan-access";
import { getPlanById, type PlanId } from "../plan-features";

/** Premium lock badge icon (crown/gem). */
export function CrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      focusable="false"
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        d="m508.944 189.11c4.433-5.587 3.976-14.164-.933-19.312l-121.018-130.017c-2.838-3.049-6.815-4.781-10.981-4.781h-230.033c-3.959 0-7.757 1.565-10.567 4.354l-131.02 130.017c-5.511 5.298-5.888 14.659-.838 20.395l241.036 282.036c5.648 6.931 17.162 6.929 22.81 0l241.035-282.037c.172-.216.343-.433.509-.655zm-182.588-24.093h-140.723l70.361-90.563zm9.345 30.004-79.706 222.543-79.706-222.543zm-191.283 0 69.908 195.187-166.811-195.187zm223.153 0h96.902l-166.81 195.187zm95-30.004h-98.22l-77.703-100.013h82.833zm-310.412-100.013h73.182l-77.704 100.013h-96.262z"
      />
    </svg>
  );
}

/** Standalone crown for FREE / non-capability locks. */
export function PlanCrownBadge({ label = "Paid plan" }: { label?: string }) {
  return (
    <Tooltip content={label}>
      <span
        className="plan-feature-crown"
        title={label}
        aria-label={label}
      >
        <Icon source={CrownIcon} />
        <style>{`
          .plan-feature-crown {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #6cb4ee;
            line-height: 0;
          }
          .plan-feature-crown .Polaris-Icon {
            margin: 0;
            width: 14px;
            height: 14px;
          }
          .plan-feature-crown .Polaris-Icon svg,
          .plan-feature-crown svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
            color: #6cb4ee;
          }
        `}</style>
      </span>
    </Tooltip>
  );
}

export function PlanFeatureBadge({
  capability,
  currentPlanId = getCurrentPlanId(),
}: {
  capability: PlanCapability;
  currentPlanId?: PlanId;
}) {
  if (planHasCapability(currentPlanId, capability)) return null;
  const required = planBadgeLabel(requiredPlanFor(capability));
  return (
    <Tooltip content={`${required} plan`}>
      <span
        className="plan-feature-crown"
        title={`${required} plan`}
        aria-label={`${required} plan feature`}
      >
        <Icon source={CrownIcon} />
        <style>{`
          .plan-feature-crown {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #6cb4ee;
            line-height: 0;
          }
          .plan-feature-crown .Polaris-Icon {
            margin: 0;
            width: 14px;
            height: 14px;
          }
          .plan-feature-crown .Polaris-Icon svg,
          .plan-feature-crown svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
            color: #6cb4ee;
          }
        `}</style>
      </span>
    </Tooltip>
  );
}

export function PlanLockBanner({
  capability,
  currentPlanId = getCurrentPlanId(),
  onUpgrade,
}: {
  capability: PlanCapability;
  currentPlanId?: PlanId;
  onUpgrade?: () => void;
}) {
  const navigate = useNavigate();
  if (planHasCapability(currentPlanId, capability)) return null;

  const required = getPlanById(requiredPlanFor(capability));

  return (
    <Banner
      title={`${required.name} feature`}
      tone="warning"
      action={{
        content: `Upgrade to ${required.name}`,
        onAction: () => {
          if (onUpgrade) onUpgrade();
          else navigate("/app/pricing");
        },
      }}
    >
      <p>{upgradeMessage(capability, currentPlanId)}</p>
    </Banner>
  );
}

/** Wraps content: visible but non-interactive when locked.
 * Pass `lockedFallback` to fully replace children (no data leak under the lock).
 */
export function PlanLockOverlay({
  capability,
  currentPlanId = getCurrentPlanId(),
  children,
  lockedFallback,
  onUpgrade,
}: {
  capability: PlanCapability;
  currentPlanId?: PlanId;
  children: ReactNode;
  lockedFallback?: ReactNode;
  onUpgrade?: () => void;
}) {
  const locked = !planHasCapability(currentPlanId, capability);
  if (!locked) return <>{children}</>;

  return (
    <div className="plan-lock-overlay">
      <div className="plan-lock-overlay__banner">
        <PlanLockBanner
          capability={capability}
          currentPlanId={currentPlanId}
          onUpgrade={onUpgrade}
        />
      </div>
      {lockedFallback != null ? (
        <div className="plan-lock-overlay__blocked">{lockedFallback}</div>
      ) : (
        <div className="plan-lock-overlay__content" aria-disabled="true">
          {children}
        </div>
      )}
      <style>{`
        .plan-lock-overlay {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .plan-lock-overlay__content {
          position: relative;
          opacity: 0.55;
          pointer-events: none;
          user-select: none;
        }
        .plan-feature-crown {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #6cb4ee;
          line-height: 0;
        }
        .plan-feature-crown .Polaris-Icon {
          margin: 0;
          width: 14px;
          height: 14px;
        }
        .plan-feature-crown .Polaris-Icon svg,
        .plan-feature-crown svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
          color: #6cb4ee;
        }
      `}</style>
    </div>
  );
}

export function usePlanUpgradeModal(
  currentPlanId: PlanId = getCurrentPlanId(),
) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [capability, setCapability] = useState<PlanCapability | null>(null);

  const openUpgrade = useCallback((cap: PlanCapability) => {
    setCapability(cap);
    setOpen(true);
  }, []);

  const closeUpgrade = useCallback(() => {
    setOpen(false);
    setCapability(null);
  }, []);

  const guard = useCallback(
    (cap: PlanCapability, action?: () => void) => {
      if (planHasCapability(currentPlanId, cap)) {
        action?.();
        return true;
      }
      openUpgrade(cap);
      return false;
    },
    [currentPlanId, openUpgrade],
  );

  const modal =
    capability == null ? null : (
      <Modal
        open={open}
        onClose={closeUpgrade}
        title="Upgrade your plan"
        primaryAction={{
          content: `View ${planBadgeLabel(requiredPlanFor(capability))} plan`,
          onAction: () => {
            closeUpgrade();
            navigate("/app/pricing");
          },
        }}
        secondaryActions={[
          {
            content: "Not now",
            onAction: closeUpgrade,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <span className="plan-feature-crown" aria-hidden>
                <Icon source={CrownIcon} />
              </span>
              <Text as="p" fontWeight="semibold">
                Locked on your current plan
              </Text>
            </InlineStack>
            <Text as="p">{upgradeMessage(capability, currentPlanId)}</Text>
            <Box
              background="bg-surface-secondary"
              borderRadius="200"
              padding="300"
            >
              <Text as="p" tone="subdued" variant="bodySm">
                You’re on {getPlanById(currentPlanId).name}. Upgrade to unlock
                this feature. Billing checkout is not connected yet — pricing
                page shows plan details.
              </Text>
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>
    );

  return {
    guard,
    openUpgrade,
    closeUpgrade,
    modal,
    lockedCapability: capability,
  };
}
