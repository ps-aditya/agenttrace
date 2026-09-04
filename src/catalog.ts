import { Product } from "./types";

// A deliberately small, fully synthetic catalog. This is NOT real merchant
// data and is not meant to be. It exists purely to give the agent something
// concrete to reason about.
//
// Tier and tags exist so recovery scoring has real signal to differentiate
// on, not just price and category. Trailrunner X2 (premium, trail/cushioned)
// and UrbanFlex Pro (mid, urban/lightweight) genuinely differ in more than
// price -- the scoring in recovery.ts should reflect that, not just pick
// "whichever is closest to the budget ceiling."
//
// sku-301 exists specifically to prove a point: it's cheap enough to fit
// almost any budget in this demo's scenarios, but it's a coffee mug, not
// footwear. Without a category constraint, a budget-only recovery search
// could "successfully" substitute a mug for running shoes -- technically
// under budget, actually useless to the buyer. A recovery engine that
// only checks price is a bad salesman: it'll sell anyone anything that
// fits their wallet, whether or not it fits what they actually wanted.
export function getCandidates(): Product[] {
  return [
    {
      id: "sku-201",
      name: "Trailrunner X2",
      price: 4799,
      category: "footwear",
      tier: "premium",
      tags: ["trail", "cushioned", "durable"],
      attributes: { activity: "trail", fit: "regular", cushioning: "high", returnWindowDays: 30 },
      availableForSale: true,
    },
    {
      id: "sku-202",
      name: "UrbanFlex Pro",
      price: 4299,
      category: "footwear",
      tier: "mid",
      tags: ["urban", "lightweight", "breathable"],
      attributes: { activity: "urban", fit: "regular", cushioning: "medium", returnWindowDays: 30 },
      availableForSale: true,
    },
    {
      id: "sku-203",
      name: "SprintCore Lite",
      price: 3599,
      category: "footwear",
      tier: "budget",
      tags: ["trail", "lightweight", "durable"],
      attributes: { activity: "trail", fit: "regular", cushioning: "high", returnWindowDays: 30 },
      availableForSale: true,
    },
    {
      id: "sku-301",
      name: "Everyday Ceramic Mug",
      price: 399,
      category: "kitchenware",
      tier: "budget",
      tags: ["kitchen", "ceramic", "everyday"],
      attributes: { material: "ceramic", returnWindowDays: 30 },
      availableForSale: true,
    },
  ];
}

export const INITIAL_SHIPPING_COST = 120;

// Simulates a real, common failure mode: a shipping/logistics quote changes
// between the moment an agent decides to buy and the moment payment is
// actually executed (carrier repricing, address-based surcharge resolving
// late, promo expiring, etc). This is scripted and deterministic on purpose
// -- the point of this demo run is to reliably reproduce one specific,
// explainable failure, not to generate random noise.
export function simulateShippingCostAtExecutionTime(): number {
  return 360;
}

// Simulates a second, qualitatively different failure class: the chosen
// item sells out between decision and payment. Unlike a cost drift, there
// is no "approve as-is" path here -- the item genuinely cannot be bought.
// Also scripted and deterministic for the same reason as above.
// Returns true if still in stock, false if it sold out.
export function simulateStockCheckAtExecutionTime(itemId: string): boolean {
  return itemId !== "sku-201"; // sku-201 (Trailrunner X2) is scripted to sell out
}
