import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productImageError, productImageSource, MAX_PRODUCT_IMAGE_LENGTH } from "../lib/product-images.ts";

test("saved images override legacy mappings, removal is preserved, and missing values use fallback", () => {
  assert.equal(productImageSource({code:"RN 183"}), "/rn-183.jpeg");
  assert.equal(productImageSource({code:"RN 183",imageData:null}), "/rn-183.jpeg");
  assert.equal(productImageSource({code:"RN 183",imageData:""}), "");
  assert.equal(productImageSource({code:"NEW",imageData:"saved"}), "saved");
  assert.equal(productImageSource({code:"NEW"}), "");
});

test("invalid formats, oversized payloads and unnormalized JPEGs are rejected", () => {
  for(const input of [false, 3, {}, "https://example.com/image.jpg", "data:image/svg+xml,<svg/>",
    "data:image/jpeg;base64,YWJj", "a".repeat(MAX_PRODUCT_IMAGE_LENGTH+1)]) {
    assert.ok(productImageError(input));
  }
  const original = readFileSync(new URL("../public/rn-183.jpeg", import.meta.url));
  assert.ok(productImageError(`data:image/jpeg;base64,${original.toString("base64")}`));
});

test("omitting, clearing, and restoring the default image are valid", () => {
  for(const input of [undefined,null,""]) assert.equal(productImageError(input),null);
});
