import { Product } from "./types";

// A deliberately small, fully synthetic catalog. This is NOT real merchant
// data and is not meant to be. It exists purely to give the agent something
// concrete to reason about.
export function getCandidates(): Product[] {
  return [
    { id: "sku-201", name: "Trailrunner X2", price: 4799 },
    { id: "sku-202", name: "UrbanFlex Pro", price: 4299 },
    { id: "sku-203", name: "SprintCore Lite", price: 3599 },
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
