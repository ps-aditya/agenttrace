import assert from "node:assert/strict";
import test from "node:test";
import { captureRecoveryMandate, evaluateRecoveryMandate, findRecoveryOption } from "./recovery";
import { Product } from "./types";

const original: Product = {
  id: "original",
  name: "Trail shoe UK 9",
  price: 4800,
  category: "footwear",
  tier: "premium",
  tags: ["trail"],
  attributes: { "option.Size": "UK 9", activity: "trail", returnWindowDays: 30 },
  availableForSale: false,
};

const mandate = captureRecoveryMandate(
  original,
  { maxCartTotal: 5000, maxItemPriceIncrease: 0 },
  { functionalKeys: ["option.Size", "activity"], fulfilmentKeys: ["returnWindowDays"] }
);

test("recovery admits only an equivalent, available candidate", () => {
  const equivalent: Product = {
    ...original,
    id: "equivalent",
    name: "Trail shoe UK 9 replacement",
    price: 4500,
    availableForSale: true,
  };
  const recovery = findRecoveryOption([original, equivalent], original, mandate, 100);
  assert.equal(recovery?.product.id, "equivalent");
  assert.equal(recovery?.mandate.eligible, true);
});

test("unknown required attributes force rejection", () => {
  const unknown: Product = {
    ...original,
    id: "unknown",
    price: 4500,
    availableForSale: true,
    attributes: { activity: "trail", returnWindowDays: 30 },
  };
  const evaluation = evaluateRecoveryMandate(unknown, original, mandate, 100);
  assert.equal(evaluation.eligible, false);
  assert.match(evaluation.rejectionReasons.join("\n"), /option.Size.*unknown/);
});

test("mandate capture refuses facts the source product did not expose", () => {
  assert.throws(
    () => captureRecoveryMandate(original, { maxCartTotal: 5000 }, { functionalKeys: ["option.Width"] }),
    /does not expose required attribute/
  );
});

test("a matching candidate is rejected when fulfilment or consent changes", () => {
  const wrongReturnWindow: Product = {
    ...original,
    id: "short-return-window",
    price: 4500,
    availableForSale: true,
    attributes: { "option.Size": "UK 9", activity: "trail", returnWindowDays: 14 },
  };
  const tooExpensive: Product = {
    ...original,
    id: "too-expensive",
    price: 4900,
    availableForSale: true,
  };
  assert.equal(findRecoveryOption([wrongReturnWindow, tooExpensive], original, mandate, 100), null);
});
