// Public SDK surface. Keep this side-effect free: importing AgentTrace must
// never start a CLI, create an order, or read a merchant catalog.
export * from "./types";
export { captureRecoveryMandate, evaluateRecoveryMandate, findRecoveryOption } from "./recovery";
export { diffAuthorization } from "./verify";
export { ShopifyStorefrontProvider } from "./providers/shopify";
export type { ShopifyStorefrontConfig } from "./providers/shopify";
