import { Product } from "../types";

export interface ShopifyStorefrontConfig {
  shopDomain: string;
  storefrontAccessToken: string;
  apiVersion?: string;
}

interface ShopifyVariantNode {
  id: string;
  title: string;
  availableForSale: boolean;
  price: { amount: string; currencyCode: string };
  selectedOptions: Array<{ name: string; value: string }>;
}

interface ShopifyProductNode {
  id: string;
  title: string;
  productType: string;
  tags: string[];
  variants: { nodes: ShopifyVariantNode[] };
}

const PRODUCTS_QUERY = `
  query AgentTraceProducts($first: Int!) {
    products(first: $first) {
      nodes {
        id title productType tags
        variants(first: 100) {
          nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } }
        }
      }
    }
  }
`;

const PRODUCT_BY_HANDLE_QUERY = `
  query AgentTraceProduct($handle: String!) {
    product(handle: $handle) {
      id title productType tags
      variants(first: 100) {
        nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } }
      }
    }
  }
`;

/**
 * Read-only, merchant-authorized Shopify Storefront connector. It intentionally
 * does not claim inventory quantities, delivery promises, or checkout control
 * that the configured Storefront API scope cannot provide.
 */
export class ShopifyStorefrontProvider {
  private readonly endpoint: string;
  private readonly token: string;

  constructor(config: ShopifyStorefrontConfig) {
    const domain = config.shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!domain) throw new Error("Shopify shopDomain is required");
    if (!config.storefrontAccessToken) throw new Error("A merchant-authorized Shopify Storefront access token is required");
    this.endpoint = `https://${domain}/api/${config.apiVersion ?? "2026-04"}/graphql.json`;
    this.token = config.storefrontAccessToken;
  }

  async listProducts(first = 50): Promise<Product[]> {
    const data = await this.request<{ products: { nodes: ShopifyProductNode[] } }>(PRODUCTS_QUERY, { first });
    return data.products.nodes.flatMap(normalizeProduct);
  }

  async getProductByHandle(handle: string): Promise<Product[]> {
    const data = await this.request<{ product: ShopifyProductNode | null }>(PRODUCT_BY_HANDLE_QUERY, { handle });
    return data.product ? normalizeProduct(data.product) : [];
  }

  private async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": this.token,
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (!response.ok || body.errors?.length || !body.data) {
      const details = body.errors?.map((error) => error.message).join("; ") ?? `HTTP ${response.status}`;
      throw new Error(`Shopify Storefront request failed: ${details}`);
    }
    return body.data;
  }
}

function normalizeProduct(product: ShopifyProductNode): Product[] {
  return product.variants.nodes.map((variant) => {
    const attributes: Product["attributes"] = {
      productType: product.productType || "uncategorized",
      ...Object.fromEntries(product.tags.map((tag) => [`tag.${tag}`, true])),
      ...Object.fromEntries(variant.selectedOptions.map((option) => [`option.${option.name}`, option.value])),
    };
    return {
      id: variant.id,
      name: variant.title === "Default Title" ? product.title : `${product.title} — ${variant.title}`,
      price: Number(variant.price.amount),
      category: product.productType || "uncategorized",
      tier: "mid",
      tags: product.tags,
      attributes,
      availableForSale: variant.availableForSale,
    };
  });
}
