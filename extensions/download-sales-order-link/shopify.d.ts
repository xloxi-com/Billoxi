import '@shopify/ui-extensions';

//@ts-ignore
declare module './src/Action.jsx' {
  const shopify: import('@shopify/ui-extensions/admin.order-details.print-action.render').Api;
  const globalThis: { shopify: typeof shopify };
}

//@ts-ignore
declare module './src/ShouldRender.js' {
  const shopify: import('@shopify/ui-extensions/admin.order-details.print-action.should-render').Api;
  const globalThis: { shopify: typeof shopify };
}
