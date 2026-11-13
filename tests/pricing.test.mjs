import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_TARGET_PROFIT_RATE,
  adjustPrice,
  marginOnCost,
  marginOnPrice,
  parsePercent,
  priceForMargin,
  simulatePrice,
  sourceComparison,
  targetRateOf,
} from "../lib/pricing.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const settingsApi = read("../app/api/settings/route.ts");
const money = (value) => `R$ ${value.toFixed(2).replace(".", ",")}`;

test("margem sobre o custo e sobre o preço, sem dividir por zero", () => {
  assert.equal(marginOnCost(3000, 2000), 0.5);
  assert.equal(marginOnPrice(3000, 2000), 1 / 3);
  assert.equal(marginOnCost(1800, 2000), -0.1);
  assert.equal(marginOnCost(3000, 0), null);
  assert.equal(marginOnCost(3000, null), null);
  assert.equal(marginOnPrice(0, 2000), null);
  assert.equal(priceForMargin(2000, 0.35), 2700);
  assert.equal(priceForMargin(1999, 0.35), 2699);
});

test("meta e percentual digitado", () => {
  assert.equal(DEFAULT_TARGET_PROFIT_RATE, 0.35);
  assert.equal(targetRateOf(0.4), 0.4);
  assert.equal(targetRateOf("0.25"), 0.25);
  assert.equal(targetRateOf(0), 0);
  assert.equal(targetRateOf(undefined), 0.35);
  assert.equal(targetRateOf(null), 0.35);
  assert.equal(targetRateOf("abc"), 0.35);
  assert.equal(targetRateOf(-1), 0.35);
  assert.equal(parsePercent("35"), 0.35);
  assert.equal(parsePercent("35,5%"), 0.355);
  assert.equal(parsePercent(" -3 "), -0.03);
  assert.equal(parsePercent(""), null);
  assert.equal(parsePercent("abc"), null);
});

test("simulação compara a peça fabricada com a comprada pronta", () => {
  const simulation = simulatePrice({ priceCents: 3000, fabricatedCostCents: 1500, purchasedCostCents: 2400, targetRate: 0.35 });
  assert.equal(simulation.fabricada.profitCents, 1500);
  assert.equal(simulation.fabricada.onCost, 1);
  assert.equal(simulation.fabricada.onPrice, 0.5);
  assert.equal(simulation.fabricada.reachesTarget, true);
  assert.equal(simulation.comprada.profitCents, 600);
  assert.equal(simulation.comprada.onCost, 0.25);
  assert.equal(simulation.comprada.reachesTarget, false);
  assert.equal(simulation.comprada.minPriceCents, 2400);
  assert.equal(simulation.comprada.targetPriceCents, 3240);
  assert.equal(simulation.cheaper, "fabricada");
  assert.equal(simulation.savingCents, 900);
  assert.equal(sourceComparison(simulation, money), "Fabricação custa R$ 9,00 a menos");

  const buying = simulatePrice({ priceCents: 3000, fabricatedCostCents: 2600, purchasedCostCents: 2000, targetRate: 0.35 });
  assert.equal(buying.cheaper, "comprada");
  assert.equal(sourceComparison(buying, money), "Revenda custa R$ 6,00 a menos");

  const loss = simulatePrice({ priceCents: 1800, fabricatedCostCents: 2000, purchasedCostCents: 2000, targetRate: 0.35 });
  assert.equal(loss.comprada.profitCents, -200);
  assert.equal(loss.cheaper, null);
  assert.equal(sourceComparison(loss, money), "Revenda e fabricação custam o mesmo");

  const missing = simulatePrice({ priceCents: 3000, fabricatedCostCents: 1500, purchasedCostCents: null, targetRate: 0.35 });
  assert.equal(missing.comprada.costCents, null);
  assert.equal(missing.comprada.onCost, null);
  assert.equal(missing.comprada.reachesTarget, null);
  assert.equal(missing.savingCents, null);
  assert.equal(sourceComparison(missing, money), "Falta o custo revenda");
  assert.equal(
    sourceComparison(simulatePrice({ priceCents: 3000, fabricatedCostCents: 0, purchasedCostCents: null, targetRate: 0.35 }), money),
    "Falta cadastrar o custo",
  );
});

test("reajuste em percentual, exato ou terminando em ,90", () => {
  assert.equal(adjustPrice(5000, 0.05), 5250);
  assert.equal(adjustPrice(5000, -0.1), 4500);
  assert.equal(adjustPrice(5000, 0.05, "ninety"), 5290);
  assert.equal(adjustPrice(5000, 0.01, "ninety"), 5090);
  assert.equal(adjustPrice(5390, 0, "ninety"), 5390);
  assert.equal(adjustPrice(5440, 0, "ninety"), 5390);
  assert.equal(adjustPrice(5450, 0, "ninety"), 5490);
  assert.equal(adjustPrice(100, -0.9, "ninety"), 90);
  assert.equal(adjustPrice(0, 0.5, "ninety"), 0);
});

test("tela Preços e margem fica no Financeiro, com simulador e meta configurável", () => {
  for (const text of [
    '["financial-pricing", "Preços e margem"]',
    'screen === "financial-pricing" && (() => {',
    "Simular reajuste em várias peças",
    "Terminar em ,90",
    "openPriceSimulator(row.product)",
    "Aplicar preço",
    "saveTargetRate",
    "rate >= targetRate",
  ])
    assert.ok(page.includes(text), text);
  assert.ok(settingsApi.includes("target_profit_rate: targetProfitRate"));
  assert.ok(settingsApi.includes("body.targetProfitRate !== undefined && body.companyName === undefined"));
  assert.ok(/add column if not exists target_profit_rate/i.test(read("../supabase/migrations/20261113040000_settings_target_profit_rate.sql")));
  // custo e margem não vão para o catálogo público
  assert.equal(/pricing|targetRate/.test(read("../app/catalogo/page.tsx")), false);
});
