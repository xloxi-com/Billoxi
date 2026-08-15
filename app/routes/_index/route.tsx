import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect, Form, useLoaderData, useRouteError } from "react-router";

import { login } from "../../shopify.server";
import { renderEmbeddedRouteError } from "../../embedded-route-error";

import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  {
    title:
      "Billoxi by XLOXI | Shopify invoices, packing slips & credit notes",
  },
  {
    name: "description",
    content:
      "Billoxi turns Shopify orders into branded invoices, packing slips, credit notes, drafts, and returns. Built by XLOXI, a Shopify development company in Sri Lanka.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

const DOCS = [
  {
    code: "SO",
    name: "Sales order",
    detail: "Every Shopify order gets a Billoxi number. Search, convert, print, or email.",
  },
  {
    code: "INV",
    name: "Invoice",
    detail: "Convert a sales order — manually, or automatically when the order is paid.",
  },
  {
    code: "PS",
    name: "Packing slip",
    detail: "Warehouse sheet with SKU and qty, converted from the sales order.",
  },
  {
    code: "CN",
    name: "Credit note",
    detail: "Created from an invoice. Void it, delete it, or issue again after void.",
  },
  {
    code: "DR",
    name: "Draft",
    detail: "Branded paperwork for Shopify Admin draft orders, then finalize to invoice.",
  },
  {
    code: "RT",
    name: "Return",
    detail: "From refunded orders, or automatically from Shopify return webhooks.",
  },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Connect",
    detail: "Install, pick a plan, add store details and a logo.",
  },
  {
    n: "02",
    title: "Brand",
    detail: "Choose a template, language, numbers, and tax layout.",
  },
  {
    n: "03",
    title: "Send",
    detail: "Convert the order, then print, download PDF, or email.",
  },
] as const;

const STATS = [
  { value: "50+", label: "XLOXI projects delivered" },
  { value: "6", label: "Document types in one app" },
  { value: "104", label: "PDF languages" },
  { value: "3+", label: "Years building Shopify" },
] as const;

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.brand} href="/" aria-label="Billoxi home">
          <img
            className={styles.logoMark}
            src="/billoxi-favicon.svg"
            alt=""
            width={36}
            height={36}
          />
          <span className={styles.logoWord}>
            Billoxi
            <small>by XLOXI</small>
          </span>
        </a>
        <nav className={styles.links} aria-label="Links">
          <a href="https://billoxi.xloxi.com/" target="_blank" rel="noreferrer">
            Product
          </a>
          <a href="https://xloxi.com/portfolio" target="_blank" rel="noreferrer">
            Portfolio
          </a>
          <a href="https://xloxi.com/" target="_blank" rel="noreferrer">
            XLOXI
          </a>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <div>
            <p className={styles.kicker}>Shopify order documents</p>
            <h1 className={styles.heading}>
              Invoices and packing slips, without the busywork.
            </h1>
            <p className={styles.lead}>
              After checkout, merchants still need paperwork. Billoxi turns the
              Shopify order into branded documents — print, PDF, or email —
              without retyping line items.
            </p>
            <div className={styles.heroActions}>
              <a
                className={styles.ghost}
                href="https://billoxi.xloxi.com/"
                target="_blank"
                rel="noreferrer"
              >
                See the product
              </a>
              <a
                className={styles.ghost}
                href="https://xloxi.com/"
                target="_blank"
                rel="noreferrer"
              >
                Built by XLOXI
              </a>
            </div>
          </div>

          {showForm ? (
            <Form className={styles.card} method="post" action="/auth/login">
              <h2>Open Billoxi</h2>
              <p>Enter your Shopify store to install or log in.</p>
              <label className={styles.label} htmlFor="shop">
                Shop domain
              </label>
              <input
                id="shop"
                className={styles.input}
                type="text"
                name="shop"
                placeholder="your-store.myshopify.com"
                autoComplete="off"
                spellCheck={false}
              />
              <span className={styles.hint}>
                e.g. my-shop-domain.myshopify.com
              </span>
              <button className={styles.button} type="submit">
                Log in
              </button>
            </Form>
          ) : (
            <div className={styles.card}>
              <h2>Open Billoxi</h2>
              <p>
                Install from Shopify Admin, or visit{" "}
                <a href="https://billoxi.xloxi.com/" target="_blank" rel="noreferrer">
                  billoxi.xloxi.com
                </a>
                .
              </p>
            </div>
          )}
        </section>

        <section className={styles.docs} aria-labelledby="docs-heading">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>Six document types</p>
            <h2 id="docs-heading">One order. Professional paperwork.</h2>
            <p>
              Line items, prices, discounts, tax, and totals always sync from
              Shopify — Billoxi does not edit them.
            </p>
          </div>
          <ul className={styles.docGrid}>
            {DOCS.map((doc) => (
              <li key={doc.code} className={styles.doc}>
                <span className={styles.code}>{doc.code}</span>
                <strong>{doc.name}</strong>
                <p>{doc.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.steps} aria-labelledby="how-heading">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>How it works</p>
            <h2 id="how-heading">Look professional on every order.</h2>
          </div>
          <ol className={styles.stepList}>
            {STEPS.map((step) => (
              <li key={step.n}>
                <span>{step.n}</span>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.studio} aria-labelledby="studio-heading">
          <div>
            <p className={styles.kicker}>From the studio</p>
            <h2 id="studio-heading">Built by XLOXI in Sri Lanka.</h2>
            <p>
              XLOXI is a Shopify development company — stores, custom apps, and
              digital systems for merchants in Sri Lanka and brands expanding
              internationally.
            </p>
            <div className={styles.studioLinks}>
              <a href="https://xloxi.com/" target="_blank" rel="noreferrer">
                xloxi.com
              </a>
              <a
                href="https://xloxi.com/portfolio"
                target="_blank"
                rel="noreferrer"
              >
                Portfolio
              </a>
              <a href="https://billoxi.xloxi.com/" target="_blank" rel="noreferrer">
                Billoxi product
              </a>
            </div>
          </div>
          <ul className={styles.stats}>
            {STATS.map((stat) => (
              <li key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.apps} aria-labelledby="apps-heading">
          <div className={styles.sectionHead}>
            <p className={styles.kicker}>XLOXI Shopify apps</p>
            <h2 id="apps-heading">Also from this studio.</h2>
          </div>
          <ul className={styles.appGrid}>
            <li>
              <a
                href="https://apps.shopify.com/approvefy"
                target="_blank"
                rel="noreferrer"
              >
                <strong>Approvefy</strong>
                <span>B2B registration and customer approval for Shopify.</span>
              </a>
            </li>
            <li>
              <a
                href="https://apps.shopify.com/offrefy"
                target="_blank"
                rel="noreferrer"
              >
                <strong>Offrefy</strong>
                <span>Quantity breaks and volume discounts for growing stores.</span>
              </a>
            </li>
          </ul>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} XLOXI PVT LTD. Billoxi is a Shopify app.</p>
        <p>
          <a href="https://billoxi.xloxi.com/" target="_blank" rel="noreferrer">
            billoxi.xloxi.com
          </a>
          {" · "}
          <a href="https://xloxi.com/" target="_blank" rel="noreferrer">
            xloxi.com
          </a>
        </p>
      </footer>
    </div>
  );
}

export function ErrorBoundary() {
  return renderEmbeddedRouteError(useRouteError(), "billoxi:landing-reload");
}
