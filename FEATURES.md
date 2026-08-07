# Billoxi — Full Feature Document

**Product:** Billoxi  
**Type:** Embedded Shopify Admin app (Sales Orders, Invoices, Credit Notes, Packing Slips)  
**Stack:** React Router, Shopify Polaris / App Bridge, Prisma  
**Billing / plans:** None — no subscription tiers or usage limits in the app today.

---

## 1. Overview

Billoxi turns Shopify orders into printable / downloadable business documents:

| Document | Typical number | Created from |
|---|---|---|
| Sales Order | `SO-0001` | Shopify order (auto) |
| Invoice | `INV-0001` | Convert from Sales Order |
| Credit Note | `CN-0001` | Create from Invoice |
| Packing Slip | `PS-0001` | Convert from Sales Order |

Order line items, customer, and payment data always come live from Shopify. Billoxi stores document numbers, notes, terms, credit-note reason/void, template customizations, store details, number series, and SMTP settings.

---

## 2. Navigation

Main app menu:

1. **Sales Orders**
2. **Invoice**
3. **Credit Note**
4. **Packing Slip**
5. **Templates**
6. **Settings**

Home (`/app`) opens the Sales Orders list.

---

## 3. Sales Orders

### 3.1 List (`/app/sales-order`)

- Browse Shopify orders as sales-order documents (paginated).
- **View tabs:** All, Unpaid, Paid, Voided, Invoiced, Open.
- **Search:** Free-text order search (debounced).
- **Filters:** Payment status (paid, pending, partially paid, refunded, voided); Fulfillment (fulfilled, unfulfilled, partially fulfilled).
- **Sort:** Sales Order, Customer, Date, Total (asc/desc).
- **Columns:** Show / hide / reorder (saved in browser). Core columns: Sales Order, Actions. Optional: Reference, Date, Company, Customer, Total, Payment status, Fulfillment status, Invoiced, Packing slip.
- **Row actions:** Print, Download PDF, Send email (SMTP + PDF when configured; else mailto)
- **Bulk / selection actions:**
  - Convert to invoice (one at a time; blocked if voided/cancelled or already invoiced).
  - Convert to packing slip (same guards).
  - Send email (needs customer email; blocked if voided/cancelled).
  - Download PDF (single PDF or ZIP for multiple).
- If no sales-order template is selected, the app prompts the merchant to pick one first.

### 3.2 Detail (`/app/sales-order/:orderId`)

- Live paper preview (scaled to template paper size / orientation).
- Left sidebar list of recent sales orders (customer, total, date, payment badge, invoiced indicator).
- **Download** — vector-style PDF.
- **Print** — print-ready PDF (admin status ribbons excluded).
- **Send Email** — uses Email templates; SMTP sends with optional PDF attach, otherwise mailto draft
- **Edit** — document number, date, customer note, terms.
  - If number changes: continue auto series **or** switch to manual numbering.
- **Convert to invoice** / **Convert to packing slip** (hidden if already converted or cancelled).
- Deep links from list: `?action=print|download|send` runs after the document is ready.
- Header payment badge from Shopify financial status.
- Admin-only status ribbon on preview (not in PDF): e.g. Invoiced, Confirmed (paid), Voided.

---

## 4. Invoices

### 4.1 List (`/app/invoice`)

- Shows only orders converted to invoices.
- Default sort: newest invoice date first.
- **View tabs:** All, Unpaid, Paid, Voided, Refunded.
- Smart status labels (e.g. Unpaid, Overdue by N days, Paid, Partial, Refunded, Voided).
- Columns include: Invoice, Reference, Date, Company, Customer, Amount, Balance Due, Status, Credit note, Actions.
- **Create credit note** from selected invoice (optional reason). Blocked if an active credit note already exists; allowed again after void.
- **Delete invoice** — removes invoice record only; blocked if a credit note still exists; sales order remains.
- Print / download / email use the selected invoice template.

### 4.2 Detail (`/app/invoice/:orderId`)

- Preview with invoice template.
- Edit: number, invoice date, customer note, terms (number + date required; number uniqueness enforced).
- Delete invoice (same rules as list).
- No “convert to invoice” (already issued).

**Default series:** `INV-` + `0001`.

---

## 5. Credit Notes

### 5.1 List (`/app/credit-note`)

- Shows only issued credit notes.
- View tabs: All, Unpaid, Paid, Voided, Refunded.
- App **Voided** status can override Shopify payment status on this list.
- Columns include Reason (tooltip).
- **Void** — soft-void (stays in list as Voided).
- **Delete** — hard-delete CN record; invoice + sales order remain.
- Credit notes are created from the **Invoice** list only (not from Sales Orders).

### 5.2 Detail (`/app/credit-note/:orderId`)

- Edit: number, date, **reason**, customer note, terms.
- Delete credit note.
- Voided ribbon when voided.

**Default series:** `CN-` + `0001`.  
Can recreate a credit note for an invoice after the previous one is voided.

---

## 6. Packing Slips

### 6.1 List (`/app/packing-slip`)

- Shows only orders converted to packing slips.
- **View tabs:** All, Unfulfilled, Partial, Fulfilled.
- Columns focus on fulfillment (Packing Slip, Order ref, Date, Company, Customer, Fulfillment, Actions).
- **Delete** packing slip record (sales order remains).
- No void flow (unlike credit notes).
- Print / download / email use packing-slip template.

### 6.2 Detail (`/app/packing-slip/:orderId`)

- Preview / PDF / print / email.
- No Edit modal for number/notes/terms on packing slip detail.
- Delete packing slip.

**Default series:** `PS-` + `0001`.  
Independent of invoicing — an order can be both invoiced and packing-slipped.

---

## 7. Document Conversion Rules

| Action | From → To | Rules |
|---|---|---|
| Convert to invoice | Sales Order → Invoice | Not if voided/cancelled or already invoiced; allocates `INV-*` |
| Convert to packing slip | Sales Order → Packing Slip | Same guards; allocates `PS-*` |
| Create credit note | Invoice → Credit Note | Optional reason; blocked if active CN exists |
| Delete invoice | Invoice record | Must delete CN first if present |
| Delete credit note | CN record | Invoice stays |
| Void credit note | Soft void | Remains listed as Voided |
| Delete packing slip | PS record | Sales order stays |

Shopify orders are never deleted by Billoxi actions.

---

## 8. Templates

### 8.1 Gallery (`/app/templates`)

- Document types: Sales Order, Invoice, Credit Note, Packing Slip.
- ~15 layout presets per type (e.g. Standard, Modern, Classic, Compact, Minimal, European, Japanese, Bold, Professional, Studio, Horizon, Ledger, Folio, Spectrum, Apex, and type-specific variants).
- Live thumbnails with store details + sample data.
- **Select / Use template** — sets active template for that document type (saved on server + browser).
- **Edit template** — opens full editor.
- **Reset all templates** — wipe customizations back to defaults.

### 8.2 Editor (`/app/templates/edit/:documentType/:templateId`)

Live paper preview while editing.

#### General
- Template name
- Language (50+ locales — translates built-in labels)
- Paper size: A5, A4, Letter
- Orientation: Portrait, Landscape
- Margins (top / bottom / left / right)

#### Transaction details
- Organization from Settings → Store details
- Logo upload (PNG/JPG/WebP, ≤ 1 MB); position left / center / right (preset-dependent)
- Details box styles: boxed, outline, plain, strip, card, inverted
- Address blocks: Billing, Shipping, Customer (visibility depends on document type)
  - Field toggles: company, name, address, phone, email, tax ID, VAT
- Document labels: title, order #, date, reference, expected shipment, payment method (where applicable)

#### Table
- Columns: #, Item (+ image size), Custom, SKU, Qty (+ unit), Rate (+ compare price), Discount, Discount %, Tax %, Tax, Amount
- Per-column widths and labels
- Packing slip: money columns suppressed in editor
- Custom fields from product metafields / metaobjects

#### Total
- Toggles + labels for subtotal, quantity, tax, shipping, discount, paid, balance due
- Tax summary table
- Payment status styles:
  1. Boxed  
  2. Under Total  
  3. In totals list  
  4. Split panels  
  5. Balance banner  

#### Appearance
- Fonts (Inter, Roboto, Open Sans, Lato, Source Sans 3, IBM Plex Sans, Nunito, Work Sans, DM Sans, Helvetica, Arial, Georgia, Merriweather, Source Serif 4, Libre Baskerville, Lora, EB Garamond, Playfair Display, Times New Roman, …)
- Colors and sizes for background, text, titles, addresses, table, totals, payment status, tax summary, notes & terms

#### Other details
- Default notes and terms text / visibility

Number series source of truth is Settings (templates sync from there).

---

## 9. Settings (`/app/settings`)

Sections (also via `?section=`): **Store details**, **Transaction numbers**, **SMTP**.  
Save Bar for unsaved changes.

### 9.1 Store details
- Organization name, address, phone, email, website
- Custom header fields (label/value, drag-reorder)
- Reset from Shopify shop data

### 9.2 Transaction numbers
- Per module: Sales Order, Invoice, Credit Note, Packing Slip
- Defaults: `SO-` / `INV-` / `CN-` / `PS-` + starting `0001`
- Edit prefix and starting number; pad width preserved
- Starting number cannot go below already allocated values (especially SO / invoice)
- Entry modes: auto / manual (used when editing sales-order numbers)

## 9.3 SMTP
- Enable, host, port, username, password, from name/email, encryption (TLS / SSL / None)
- Required for sending email with PDF attachment from the app

### 9.4 Email templates
- Per document type (Sales order, Invoice, Credit note, Packing slip):
  - Subject and body with placeholders (`{{documentNumber}}`, `{{customerName}}`, `{{total}}`, …)
  - **Attach PDF when sending** toggle
- Shared email design: header color, accent color, footer text, store-name header
- Live preview in Settings
- When SMTP is enabled: Send Email delivers via SMTP (PDF attached if enabled)
- When SMTP is off: opens a `mailto:` draft using the same subject/body templates

---

## 10. Preview, Print & Export

| Feature | Behavior |
|---|---|
| Live preview | Full paper layout, scaled to fit |
| Paper | A5 / A4 / Letter × portrait / landscape |
| Admin ribbons | On-screen only (Invoiced, Confirmed, Voided, Paid, Pending, Partial, Refunded, …) — excluded from print/PDF |
| Single download / print | From detail page (vector DOM → PDF) |
| List quick actions | Print / download / email without opening detail |
| Bulk download | Multi-select → one PDF or ZIP of PDFs |
| Document kinds | `sales-order`, `invoice`, `credit-note`, `packing-slip` |

---

## 11. Email

- **Settings → Email templates** control subject, body, design, and PDF attach per document type.
- **Settings → SMTP** must be enabled (host + from email) to send from the app with PDF attachment.
- Without SMTP, Send Email opens a `mailto:` draft using the configured templates (PDF cannot be attached via mailto).
- Requires customer email on the order.
- Blocked for voided/cancelled orders where applicable.

---

## 12. Compliance & Webhooks

| Webhook | Purpose |
|---|---|
| `app/uninstalled` | Clears shop sessions |
| `app/scopes_update` | Handles scope changes |
| `customers/data_request` | GDPR data request (HMAC verified; export still TODO) |
| `customers/redact` | GDPR customer redact (HMAC verified; full redact still TODO) |
| `shop/redact` | Shop redact after uninstall — deletes sessions, templates, settings, document numbers, invoice/packing/credit-note status rows |

---

## 13. Cross-Cutting Behaviors

- Template must be selected per document type for full workflows.
- Voided / cancelled Shopify orders cannot be converted or emailed from normal flows.
- Success/error toasts show once per action (no duplicate toast spam).
- Parent app shell does not revalidate on every child navigation (keeps nav snappy).
- Document detail loads the preview first; sidebar list can stream in afterward.

---

## 14. Route Map

| Path | Purpose |
|---|---|
| `/app` | Sales Orders (home) |
| `/app/sales-order` | Sales order list |
| `/app/sales-order/:orderId` | Sales order detail |
| `/app/sales-order/export/:orderId` | Export payload for client PDF |
| `/app/sales-order/bulk-download` | Bulk PDF / ZIP |
| `/app/invoice` | Invoice list |
| `/app/invoice/:orderId` | Invoice detail |
| `/app/credit-note` | Credit note list |
| `/app/credit-note/:orderId` | Credit note detail |
| `/app/packing-slip` | Packing slip list |
| `/app/packing-slip/:orderId` | Packing slip detail |
| `/app/templates` | Template gallery |
| `/app/templates/edit/:documentType/:templateId` | Template editor |
| `/app/settings` | Store details / numbers / SMTP |

---

## 15. What’s Not Included (today)

- App billing / paid plans / usage limits
- SMTP-based email send without configuring SMTP (falls back to mailto)
- Fully completed GDPR customer data export / customer redact execution
- Deleting Shopify orders from the app

---

*Generated for Billoxi feature reference. Update this file when major product behavior changes.*
