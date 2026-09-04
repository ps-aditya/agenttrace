#!/usr/bin/env node
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { runScenario } from "./engine";
import { RuleBasedBrain, GeminiBrain, AgentBrain } from "./brain";
import { captureRecoveryMandate, findRecoveryOption } from "./recovery";
import { Product, RecoveryMandate } from "./types";
import { ShopifyStorefrontProvider } from "./providers/shopify";

const args = process.argv.slice(2);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => args.includes(`--${name}`);

function help() {
  console.log(`AgentTrace — authorization-preserving checkout recovery

Demo:
  agenttrace [--scenario=oos] [--auto-approve] [--brain=gemini]

Shopify (merchant-authorized Storefront API):
  agenttrace shopify inspect --shop=store.myshopify.com --token=... --handle=product-handle
  agenttrace shopify capture --shop=... --token=... --handle=... --variant-id=... --budget=5000 \\
    --functional=option.Size,tag.trail --out=mandate.json
  agenttrace shopify recover --shop=... --token=... --mandate=mandate.json

Environment alternatives: AGENTTRACE_SHOPIFY_SHOP and AGENTTRACE_SHOPIFY_STOREFRONT_TOKEN.
The connector reads live product/variant availability and price. It does not
claim inventory quantity, delivery promises, or control a Shopify checkout.
`);
}

function provider() {
  return new ShopifyStorefrontProvider({
    shopDomain: value("shop") ?? process.env.AGENTTRACE_SHOPIFY_SHOP ?? "",
    storefrontAccessToken: value("token") ?? process.env.AGENTTRACE_SHOPIFY_STOREFRONT_TOKEN ?? "",
  });
}

function csv(name: string): string[] {
  return (value(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function selectVariant(products: Product[]): Product {
  const variantId = value("variant-id");
  const selected = variantId ? products.find((product) => product.id === variantId) : products.find((product) => product.availableForSale);
  if (!selected) throw new Error("No matching sellable variant found. Pass --variant-id from `shopify inspect`.");
  return selected;
}

async function shopifyCommand() {
  const action = args[1];
  const handle = value("handle");
  if (!action || !["inspect", "capture", "recover"].includes(action)) throw new Error("Use `shopify inspect`, `shopify capture`, or `shopify recover`.");

  const shopify = provider();
  if (action === "recover") {
    const mandatePath = value("mandate");
    if (!mandatePath) throw new Error("`shopify recover` requires --mandate=path/to/mandate.json");
    const snapshot = JSON.parse(fs.readFileSync(mandatePath, "utf8")) as { original: Product; mandate: RecoveryMandate; shippingCost: number };
    const candidates = await shopify.listProducts();
    const recovery = findRecoveryOption(candidates, snapshot.original, snapshot.mandate, snapshot.shippingCost);
    console.log(JSON.stringify({
      decision: recovery ? (recovery.requiresHumanApproval ? "require_approval" : "recover") : "abort",
      source: "live_shopify_storefront",
      checkedAt: new Date().toISOString(),
      recovery,
    }, null, 2));
    return;
  }

  if (!handle) throw new Error(`shopify ${action} requires --handle=product-handle`);
  const variants = await shopify.getProductByHandle(handle);
  if (action === "inspect") {
    console.log(JSON.stringify({ source: "live_shopify_storefront", checkedAt: new Date().toISOString(), variants }, null, 2));
    return;
  }

  const budget = Number(value("budget"));
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("`shopify capture` requires a positive --budget=INR");
  const original = selectVariant(variants);
  const functionalKeys = csv("functional");
  const fulfilmentKeys = csv("fulfilment");
  const mandate = captureRecoveryMandate(
    original,
    { maxCartTotal: budget, maxItemPriceIncrease: Number(value("max-item-increase") ?? 0) },
    { functionalKeys, fulfilmentKeys, substitutionConsent: has("approval-required") ? "human_approval_required" : "direct_equivalent" }
  );
  const snapshot = { source: "live_shopify_storefront", original, mandate, shippingCost: Number(value("shipping") ?? 0) };
  const output = value("out");
  if (output) {
    fs.writeFileSync(path.resolve(output), JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`Mandate captured from live Shopify data: ${path.resolve(output)}`);
  } else {
    console.log(JSON.stringify(snapshot, null, 2));
  }
}

function selectBrain(): AgentBrain {
  if (value("brain") === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("--brain=gemini requires GEMINI_API_KEY");
    return new GeminiBrain(key);
  }
  return new RuleBasedBrain();
}

async function demo() {
  const result = await runScenario({
    label: "single-demo",
    intent: "Buy me running shoes, budget ₹5000, prioritize quality over price.",
    maxBudget: 5000,
    scenarioType: value("scenario") === "oos" ? "oos" : "drift",
    autoApprove: has("auto-approve"),
    onNarration: (line) => console.log(`${line}\n`),
  }, selectBrain());
  console.log(`Trace: ${result.tracePath}`);
  console.log(`Summary: ${String(result.outcome.status).toUpperCase()} · recovered=${result.recovered}`);
}

async function main() {
  if (has("help") || has("h")) return help();
  if (args[0] === "shopify") return shopifyCommand();
  return demo();
}

main().catch((error) => {
  console.error(`AgentTrace error: ${error.message}`);
  process.exit(1);
});
