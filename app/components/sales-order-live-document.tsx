import { memo, useMemo, type ReactNode } from "react";
import {
  formatOrderDate,
  formatStoreAddressLines,
  appearanceCssVars,
  buildTaxSummaryFromLineItems,
  currencySymbol,
  defaultTemplateAppearance,
  formatSalesOrderDocumentNumber,
  formatTaxLineLabel,
  formatQuantityDisplay,
  computeTotalItemQuantity,
  formatAmountDisplay,
  hasNonZeroAmount,
  shouldShowDocumentPaidAmount,
  shouldShowDocumentBalanceDue,
  shouldShowDocumentRefundedAmount,
  lineItemImageSizePx,
  normalizePaymentStatusStyle,
  resolveDisplayedUnitPrice,
  resolveTaxSummaryLabel,
  taxSummaryDisplayRows,
  taxSummaryTotals,
  reconcileTaxSummaryToOrderTotal,
  salesOrderLayoutStyle,
  salesOrderLogoPosition,
  salesOrderMetaStyle,
  type PaymentStatusStyle,
  type SalesOrderDocumentData,
  type TemplateEditorSettings,
} from "../sales-order-document";
import type { StoreDetails } from "../store-details";

const numericColumnKeys = new Set([
  "quantity",
  "rate",
  "discount",
  "discountPercentage",
  "taxPercentage",
  "taxAmount",
  "amount",
]);

const fieldFallbacks: Record<string, string> = {
  company: "Company",
  name: "Name",
  address: "Address",
  taxId: "Tax ID",
  vatNumber: "VAT number",
  phone: "Phone",
  email: "Email",
};

function renderPartyFields(
  fields: TemplateEditorSettings["billingDetails"],
  party: SalesOrderDocumentData["billing"],
  prefix: string,
) {
  return fields.map((field) => {
    if (!field.enabled) return null;

    if (field.key === "company") {
      return party.company ? (
        <strong
          key={`${prefix}-company`}
          className="live-document__party-company"
        >
          {party.company}
        </strong>
      ) : null;
    }

    if (field.key === "name") {
      return party.name ? (
        <strong key={`${prefix}-name`} className="live-document__party-name">
          {party.name}
        </strong>
      ) : null;
    }

    if (field.key === "address") {
      if (party.address.length === 0) return null;
      return (
        <div
          key={`${prefix}-address`}
          className="live-document__customer-address"
        >
          {party.address.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      );
    }

    const value =
      field.key === "phone"
        ? party.phone
        : field.key === "email"
          ? party.email
          : "";
    if (!value) return null;

    return (
      <span key={`${prefix}-${field.key}`} className="live-document__contact-line">
        {field.label.trim() || fieldFallbacks[field.key] || field.key}:{" "}
        {value}
      </span>
    );
  });
}

export const SalesOrderLiveDocument = memo(function SalesOrderLiveDocument({
  settings,
  templateId,
  storeDetails,
  order,
  showLogoPlaceholder = false,
}: {
  settings: TemplateEditorSettings;
  templateId: string;
  storeDetails: StoreDetails;
  order: SalesOrderDocumentData;
  /** Template gallery/editor only — never on real sales-order documents. */
  showLogoPlaceholder?: boolean;
}) {
  const columns = useMemo(
    () => settings.columns.filter((column) => column.enabled),
    [settings.columns],
  );
  const totalWidth =
    columns.reduce((total, column) => total + Math.max(column.width, 1), 0) || 1;
  const organizationName = storeDetails.name || "Organization";
  const logoDataUrl = storeDetails.logoDataUrl || settings.logoDataUrl;
  const logoFileName = storeDetails.logoFileName || settings.logoFileName;
  const addressLines = formatStoreAddressLines(storeDetails);
  const styleName = salesOrderLayoutStyle(templateId);
  const logoPosition = salesOrderLogoPosition(templateId, settings);
  const metaStyle = salesOrderMetaStyle(templateId, settings);
  const isPackingSlip = templateId.startsWith("packing-");
  const orderDate = formatOrderDate(order.documentDate || order.createdAt);
  const documentNumber =
    order.documentNumber ||
    formatSalesOrderDocumentNumber(settings.numbering);
  const currencyPrefix = currencySymbol(order.currencyCode);
  const taxSummaryConfig = settings.taxSummary;
  // Treat missing/undefined as on (defaults); only explicit false hides it.
  const taxSummaryEnabled = taxSummaryConfig?.enabled !== false;
  const taxSummary = useMemo(() => {
    const rawTaxSummary =
      (order.taxSummary?.length ?? 0) > 0
        ? order.taxSummary
        : buildTaxSummaryFromLineItems(order.lineItems);
    return reconcileTaxSummaryToOrderTotal(
      rawTaxSummary,
      order.total,
      order.tax,
    );
  }, [order.lineItems, order.tax, order.taxSummary, order.total]);
  const taxSummaryRows = useMemo(
    () => taxSummaryDisplayRows(taxSummary),
    [taxSummary],
  );
  const taxTotals = useMemo(
    () => taxSummaryTotals(taxSummary, order.total),
    [order.total, taxSummary],
  );
  const moneySymbol = currencySymbol(order.currencyCode);
  const taxDetailsLabel = resolveTaxSummaryLabel(
    taxSummaryConfig?.detailsLabel || "Tax Details",
    moneySymbol,
  );
  const taxableHeader = resolveTaxSummaryLabel(
    taxSummaryConfig?.taxableAmountLabel || "Taxable Amount ({currency})",
    moneySymbol,
  );
  const taxAmountHeader = resolveTaxSummaryLabel(
    taxSummaryConfig?.taxAmountLabel || "Tax Amount ({currency})",
    moneySymbol,
  );
  const totalAmountHeader = resolveTaxSummaryLabel(
    taxSummaryConfig?.totalAmountLabel || "Total Amount ({currency})",
    moneySymbol,
  );
  const showTaxable = taxSummaryConfig?.showTaxableAmount !== false;
  const showTaxAmt = taxSummaryConfig?.showTaxAmount !== false;
  const showTotalAmt = taxSummaryConfig?.showTotalAmount !== false;
  const paymentStatusStyle = normalizePaymentStatusStyle(
    settings.totals.paymentStatusStyle,
  );
  const showPaid = shouldShowDocumentPaidAmount(
    order,
    settings.totals.showPaidAmount,
  );
  const showBalance = shouldShowDocumentBalanceDue(
    order,
    settings.totals.showBalanceDue,
  );
  const showRefunded = shouldShowDocumentRefundedAmount(order);
  const showPaymentStatus = showPaid || showBalance || showRefunded;
  const paymentColumnCount = ([showPaid, showRefunded, showBalance].filter(
    Boolean,
  ).length === 3
    ? 6
    : [showPaid, showRefunded, showBalance].filter(Boolean).length === 2
      ? 4
      : 2) as 2 | 4 | 6;

  const paymentStatusRows = (
    variant: "totalsRow" | "banner" | "panel",
  ): ReactNode => (
    <>
      {showPaid ? (
        <div
          className={
            variant === "panel"
              ? "live-document__payment-panel"
              : variant === "banner"
                ? "live-document__payment-row"
                : "live-document__payment-row"
          }
        >
          <span className="live-document__payment-status-label">
            {settings.totals.paidAmountLabel}
          </span>
          <span className="live-document__payment-status-value">
            {`${currencyPrefix}${formatAmountDisplay(order.paidAmount)}`}
          </span>
        </div>
      ) : null}
      {showRefunded ? (
        <div
          className={
            variant === "panel"
              ? "live-document__payment-panel"
              : variant === "banner"
                ? "live-document__payment-row"
                : "live-document__payment-row"
          }
        >
          <span className="live-document__payment-status-label">
            {settings.totals.refundedAmountLabel}
          </span>
          <span className="live-document__payment-status-value">
            {`${currencyPrefix}${formatAmountDisplay(order.refundedAmount)}`}
          </span>
        </div>
      ) : null}
      {showBalance ? (
        <div
          className={
            variant === "panel"
              ? "live-document__payment-panel live-document__payment-panel--balance"
              : variant === "banner"
                ? "live-document__payment-row live-document__payment-row--banner"
                : "live-document__payment-row"
          }
        >
          <span className="live-document__payment-status-label">
            {settings.totals.balanceDueLabel}
          </span>
          <span className="live-document__payment-status-value">
            {`${currencyPrefix}${formatAmountDisplay(order.balanceDue)}`}
          </span>
        </div>
      ) : null}
    </>
  );

  const boxedPaymentStatus = showPaymentStatus ? (
    <div
      className="live-document__payment-status"
      data-style={"boxed" satisfies PaymentStatusStyle}
      data-columns={paymentColumnCount}
    >
      {showPaid ? (
        <>
          <div className="live-document__payment-status-cell live-document__payment-status-cell--label">
            <span className="live-document__payment-status-label">
              {settings.totals.paidAmountLabel}
            </span>
          </div>
          <div className="live-document__payment-status-cell live-document__payment-status-cell--value">
            <span className="live-document__payment-status-value">
              {`${currencyPrefix}${formatAmountDisplay(order.paidAmount)}`}
            </span>
          </div>
        </>
      ) : null}
      {showRefunded ? (
        <>
          <div className="live-document__payment-status-cell live-document__payment-status-cell--label">
            <span className="live-document__payment-status-label">
              {settings.totals.refundedAmountLabel}
            </span>
          </div>
          <div className="live-document__payment-status-cell live-document__payment-status-cell--value">
            <span className="live-document__payment-status-value">
              {`${currencyPrefix}${formatAmountDisplay(order.refundedAmount)}`}
            </span>
          </div>
        </>
      ) : null}
      {showBalance ? (
        <>
          <div className="live-document__payment-status-cell live-document__payment-status-cell--label">
            <span className="live-document__payment-status-label">
              {settings.totals.balanceDueLabel}
            </span>
          </div>
          <div className="live-document__payment-status-cell live-document__payment-status-cell--value">
            <span className="live-document__payment-status-value">
              {`${currencyPrefix}${formatAmountDisplay(order.balanceDue)}`}
            </span>
          </div>
        </>
      ) : null}
    </div>
  ) : null;

  const cellValue = (
    columnKey: string,
    item: SalesOrderDocumentData["lineItems"][number],
    index: number,
  ) => {
    switch (columnKey) {
      case "number":
        return String(index + 1);
      case "item": {
        const itemColumn = settings.columns.find(
          (column) => column.key === "item",
        );
        const showImage = Boolean(itemColumn?.showImage && item.imageUrl);
        const imagePx = lineItemImageSizePx(itemColumn?.imageSize);
        return (
          <span className="live-document__item-cell">
            {showImage ? (
              <img
                className="live-document__item-image"
                src={item.imageUrl}
                alt=""
                width={imagePx}
                height={imagePx}
                crossOrigin="anonymous"
                style={{ width: imagePx, height: imagePx }}
              />
            ) : null}
            <span className="live-document__item-text">
              {item.title}
              {item.variantTitle ? <small>{item.variantTitle}</small> : null}
            </span>
          </span>
        );
      }
      case "quantity":
        return formatQuantityDisplay(item.quantity);
      case "ean":
      case "sku":
        return item.sku || "—";
      case "rate": {
        const showCompare = Boolean(
          settings.columns.find((column) => column.key === "rate")
            ?.showComparePrice,
        );
        const { rate, compareAtPrice } = resolveDisplayedUnitPrice(
          item,
          showCompare,
        );
        return (
          <span className="live-document__rate-cell">
            <span className="live-document__rate-value">{rate}</span>
            {compareAtPrice ? (
              <small className="live-document__compare-price">
                {compareAtPrice}
              </small>
            ) : null}
          </span>
        );
      }
      case "discount":
        return formatAmountDisplay(item.discount || 0);
      case "discountPercentage":
        return item.discountPercentage || "0,00%";
      case "taxPercentage":
        return item.taxPercentage || "0,00%";
      case "taxAmount":
        return formatAmountDisplay(item.taxAmount || 0);
      case "amount":
        return formatAmountDisplay(item.amount || 0);
      case "custom":
        return "—";
      default:
        return "—";
    }
  };

  return (
    <div
      className={`live-document live-document--${styleName} live-document--logo-${logoPosition} live-document--meta-${metaStyle}${isPackingSlip ? " live-document--packing-slip" : ""}`}
      style={appearanceCssVars(
        settings.appearance ?? defaultTemplateAppearance,
      )}
    >
      <header className="live-document__header">
        {settings.header.showOrganization ? (
          <div className="live-document__organization">
            {settings.header.showLogo ? (
              logoDataUrl ? (
                <img
                  alt={logoFileName || "Organization logo"}
                  className="live-document__logo-image"
                  src={logoDataUrl}
                  style={{
                    maxHeight: `${settings.logoSize / 10}em`,
                    maxWidth: `${settings.logoSize}%`,
                  }}
                />
              ) : showLogoPlaceholder ? (
                <div
                  className="live-document__logo live-document__logo--placeholder"
                  style={{
                    maxHeight: `${settings.logoSize / 10}em`,
                    maxWidth: `${Math.max(settings.logoSize, 28)}%`,
                  }}
                >
                  Your Logo
                </div>
              ) : null
            ) : null}
            <strong className="live-document__organization-name">
              {organizationName}
            </strong>
            {addressLines.length > 0 ? (
              addressLines.map((line, index) => (
                <span key={`${index}-${line}`}>{line}</span>
              ))
            ) : (
              <span>Add store details in Settings</span>
            )}
          </div>
        ) : null}
        <div className="live-document__title">
          {settings.header.showDocumentTitle ? (
            <h1>{settings.transactionLabels.documentTitle}</h1>
          ) : null}
          {settings.header.showOrderNumber ? (
            <strong className="live-document__order-number">
              {settings.transactionLabels.orderNumber} {documentNumber}
            </strong>
          ) : null}
          <dl className="live-document__metadata">
            {settings.header.showDate ? (
              <>
                <dt>{settings.transactionLabels.date}</dt>
                <dd>{orderDate}</dd>
              </>
            ) : null}
            <dt>{settings.transactionLabels.reference}</dt>
            <dd>{order.referenceNumber || order.name}</dd>
            {settings.header.showExpectedShipmentDate &&
            order.expectedShipmentDate ? (
              <>
                <dt>{settings.transactionLabels.expectedShipmentDate}</dt>
                <dd>{order.expectedShipmentDate}</dd>
              </>
            ) : null}
            {settings.header.showPaymentMethod && order.paymentMethod ? (
              <>
                <dt>{settings.transactionLabels.paymentMethod}</dt>
                <dd>{order.paymentMethod}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </header>

      <section className="live-document__details">
        {settings.header.showBilling ||
        settings.header.showShipping ||
        settings.header.showCustomerDetails ? (
          <div className="live-document__address-blocks">
            {settings.header.showBilling ? (
              <div className="live-document__customer live-document__customer--billing">
                <span className="live-document__address-label">
                  {settings.transactionLabels.customer}
                </span>
                {renderPartyFields(
                  settings.billingDetails,
                  order.billing,
                  "billing",
                )}
              </div>
            ) : null}
            {settings.header.showShipping ? (
              <div className="live-document__customer live-document__customer--shipping">
                <span className="live-document__address-label">
                  {settings.transactionLabels.shipping}
                </span>
                {renderPartyFields(
                  settings.shippingDetails,
                  order.shipping,
                  "shipping",
                )}
              </div>
            ) : null}
            {settings.header.showCustomerDetails ? (
              <div className="live-document__customer live-document__customer--details">
                <span className="live-document__address-label">
                  {settings.transactionLabels.customerDetails}
                </span>
                {renderPartyFields(
                  settings.customerBlockDetails,
                  order.customer,
                  "customer",
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <table className="live-document__table">
        <colgroup>
          {columns.map((column) => (
            <col
              key={column.key}
              style={{
                width: `${(Math.max(column.width, 1) / totalWidth) * 100}%`,
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={[
                  numericColumnKeys.has(column.key)
                    ? "live-document__cell--numeric"
                    : "",
                  column.key === "sku" || column.key === "ean"
                    ? "live-document__cell--sku"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.lineItems.map((item, index) => (
            <tr key={`${item.title}-${index}`}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={[
                    numericColumnKeys.has(column.key)
                      ? "live-document__cell--numeric"
                      : "",
                    column.key === "rate" ? "live-document__cell--rate" : "",
                    column.key === "sku" || column.key === "ean"
                      ? "live-document__cell--sku"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined}
                >
                  {cellValue(column.key, item, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {settings.totals.showQuantity ? (
        <div className="live-document__items-in-total">
          {settings.totals.itemsInTotalLabel}:{" "}
          {computeTotalItemQuantity(order.lineItems)}
        </div>
      ) : null}

      <section
        className="live-document__totals"
        data-payment-style={paymentStatusStyle}
      >
        {settings.totals.showSubtotal ? (
          <div>
            <span>{settings.totals.subtotalLabel}</span>
            <span>{formatAmountDisplay(order.subtotal)}</span>
          </div>
        ) : null}
        {settings.totals.showTaxLines
          ? taxSummary
              .filter((row) => hasNonZeroAmount(row.taxAmount))
              .map((row) => (
              <div key={`${row.title}-${row.rate}-${row.taxAmount}`}>
                <span>{formatTaxLineLabel(row)}</span>
                <span>{formatAmountDisplay(row.taxAmount)}</span>
              </div>
            ))
          : null}
        {settings.totals.showDiscountAmount &&
        hasNonZeroAmount(order.discount) ? (
          <div>
            <span>{settings.totals.discountAmountLabel}</span>
            <span>{formatAmountDisplay(order.discount)}</span>
          </div>
        ) : null}
        {settings.totals.showShippingPrice &&
        hasNonZeroAmount(order.shippingPrice) ? (
          <div>
            <span>{settings.totals.shippingPriceLabel}</span>
            <span>{formatAmountDisplay(order.shippingPrice)}</span>
          </div>
        ) : null}
        {settings.totals.showVatAmount && hasNonZeroAmount(order.tax) ? (
          <div>
            <span>{settings.totals.vatAmountLabel}</span>
            <span>{formatAmountDisplay(order.tax)}</span>
          </div>
        ) : null}
        <div className="live-document__grand-total">
          <strong>{settings.totals.totalLabel}</strong>
          <strong>
            {`${currencyPrefix}${formatAmountDisplay(order.total)}`}
          </strong>
        </div>
        {paymentStatusStyle === "inTotals" && showPaymentStatus ? (
          <div className="live-document__payment-in-totals">
            {paymentStatusRows("totalsRow")}
          </div>
        ) : null}
        {paymentStatusStyle === "underTotal" && showPaymentStatus ? (
          <div className="live-document__payment-under-total">
            {paymentStatusRows("totalsRow")}
          </div>
        ) : null}
        {paymentStatusStyle === "splitPanels" && showPaymentStatus ? (
          <div
            className="live-document__payment-split-panels"
            data-count={([showPaid, showRefunded, showBalance].filter(Boolean)
              .length || 1) as 1 | 2 | 3}
          >
            {paymentStatusRows("panel")}
          </div>
        ) : null}
        {paymentStatusStyle === "balanceBanner" && showPaymentStatus ? (
          <div className="live-document__payment-balance-banner">
            {paymentStatusRows("banner")}
          </div>
        ) : null}
      </section>

      {paymentStatusStyle === "boxed" ? boxedPaymentStatus : null}

      <footer className="live-document__footer">
        {taxSummaryEnabled && taxSummaryRows.length > 0 ? (
          <section className="live-document__tax-summary">
            <strong className="live-document__tax-summary-title">
              {taxSummaryConfig?.title || "Tax Summary"}
            </strong>
            <table className="live-document__tax-summary-table">
              <thead>
                <tr>
                  <th>{taxDetailsLabel}</th>
                  {showTaxable ? (
                    <th className="live-document__cell--numeric">
                      {taxableHeader}
                    </th>
                  ) : null}
                  {showTaxAmt ? (
                    <th className="live-document__cell--numeric">
                      {taxAmountHeader}
                    </th>
                  ) : null}
                  {showTotalAmt ? (
                    <th className="live-document__cell--numeric">
                      {totalAmountHeader}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {taxSummaryRows.map((row) => (
                  <tr key={row.details}>
                    <td>{row.details}</td>
                    {showTaxable ? (
                      <td className="live-document__cell--numeric">
                        {row.taxableAmount}
                      </td>
                    ) : null}
                    {showTaxAmt ? (
                      <td className="live-document__cell--numeric">
                        {row.taxAmount}
                      </td>
                    ) : null}
                    {showTotalAmt ? (
                      <td className="live-document__cell--numeric">
                        {row.totalAmount}
                      </td>
                    ) : null}
                  </tr>
                ))}
                <tr className="live-document__tax-summary-total">
                  <td>
                    <strong>{taxSummaryConfig?.totalLabel || "Total"}</strong>
                  </td>
                  {showTaxable ? (
                    <td className="live-document__cell--numeric">
                      <strong>
                        {moneySymbol}
                        {taxTotals.taxableAmount}
                      </strong>
                    </td>
                  ) : null}
                  {showTaxAmt ? (
                    <td className="live-document__cell--numeric">
                      <strong>
                        {moneySymbol}
                        {taxTotals.taxAmount}
                      </strong>
                    </td>
                  ) : null}
                  {showTotalAmt ? (
                    <td className="live-document__cell--numeric">
                      <strong>
                        {moneySymbol}
                        {taxTotals.totalAmount}
                      </strong>
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </section>
        ) : null}
        <div className="live-document__notes">
          <strong>{settings.notesLabel}</strong>
          <span>{settings.notes}</span>
        </div>
        <div className="live-document__terms">
          <strong>{settings.termsLabel}</strong>
          <span>{settings.terms}</span>
        </div>
        {settings.showSignature || settings.showStamp ? (
          <div className="live-document__endorsements">
            {settings.showSignature ? (
              <div className="live-document__signature">
                Authorized Signature
              </div>
            ) : (
              <div className="live-document__endorsement-spacer" />
            )}
            {settings.showStamp ? (
              <div className="live-document__stamp">Company Stamp</div>
            ) : (
              <div className="live-document__endorsement-spacer" />
            )}
          </div>
        ) : null}
      </footer>
    </div>
  );
});
