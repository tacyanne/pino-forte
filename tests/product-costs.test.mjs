import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COST_SOURCE_LABEL,
  costUseAt,
  latestCostUse,
  parseCostUseInput,
  planCostUseChange,
  ProductCostError,
  costOfSourceAt,
  costSourceOf,
  TARGET_PROFIT_ON_COST,
  costAt,
  normalizePieceCode,
  openCost,
  parseProductCostInput,
  planProductCostChange,
  previousDay,
  profitOnCost,
  summarizeSalesProfit,
  totalCostCents,
} from "../lib/product-costs.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const catalogApi = read("../app/api/catalog/route.ts");
const costStore = read("../lib/product-cost-store.ts");
const publicCatalog = read("../lib/catalog-products.ts");
const page = read("../app/page.tsx");

const row = (values) => ({
  id: 1,
  productId: 7,
  rawMaterialCostCents: 1500,
  freightCents: 0,
  additionalCostsCents: 500,
  unitCostCents: 2000,
  startsAt: "2026-06-01",
  endsAt: null,
  ...values,
});

test("entrada de custo valida valores e data", () => {
  assert.equal(parseProductCostInput(undefined, "2026-11-11"), null);
  assert.deepEqual(parseProductCostInput({ materialCents: 1500.4, laborCents: 500 }, "2026-11-11"), {
    materialCents: 1500,
    laborCents: 500,
    freightCents: 0,
    startsAt: "2026-11-11",
    source: "fabricada",
    supplier: "",
  });
  assert.throws(() => parseProductCostInput({ materialCents: -1 }, "2026-11-11"), ProductCostError);
  assert.throws(() => parseProductCostInput({ materialCents: "abc" }, "2026-11-11"), ProductCostError);
  assert.throws(() => parseProductCostInput({ materialCents: 1, startsAt: "11/11/2026" }, "2026-11-11"), ProductCostError);
  assert.throws(() => parseProductCostInput("x", "2026-11-11"), ProductCostError);
  assert.equal(new ProductCostError("x").status, 400);
});

test("custo vigente respeita o período de cada vigência", () => {
  const history = [
    row({ id: 1, unitCostCents: 2000, startsAt: "2026-06-01", endsAt: "2026-11-10" }),
    row({ id: 2, unitCostCents: 2500, startsAt: "2026-11-11", endsAt: null }),
    row({ id: 3, productId: 8, unitCostCents: 999 }),
  ];
  assert.equal(costAt(history, 7, "2026-05-31"), null);
  assert.equal(costAt(history, 7, "2026-06-01").id, 1);
  assert.equal(costAt(history, 7, "2026-11-10T23:00:00").id, 1);
  assert.equal(costAt(history, 7, "2026-11-11").id, 2);
  assert.equal(costAt(history, 99, "2026-11-11"), null);
  assert.equal(openCost(history, 7).id, 2);
  assert.equal(previousDay("2026-11-01"), "2026-10-31");
});

test("gravação cria, corrige ou abre nova vigência sem perder histórico", () => {
  const input = { materialCents: 2500, laborCents: 0, freightCents: 0, startsAt: "2026-11-11" };
  assert.deepEqual(planProductCostChange(null, input), { kind: "insert", closeId: null, closeEndsAt: null });
  assert.deepEqual(planProductCostChange(null, { ...input, materialCents: 0 }), { kind: "none" });

  const open = row({ id: 5 });
  const unchanged = { materialCents: 1500, laborCents: 500, freightCents: 0 };
  assert.deepEqual(planProductCostChange(open, { ...unchanged, startsAt: "2026-06-01" }), { kind: "none" });
  // só a data de início mudou: corrige a vigência atual
  assert.deepEqual(planProductCostChange(open, { ...unchanged, startsAt: "2026-11-11" }), { kind: "update", id: 5 });
  assert.deepEqual(planProductCostChange(open, { ...unchanged, startsAt: "2026-05-20" }), { kind: "update", id: 5 });
  assert.deepEqual(planProductCostChange(open, input), { kind: "insert", closeId: 5, closeEndsAt: "2026-11-10" });
  assert.deepEqual(planProductCostChange(open, { ...input, startsAt: "2026-06-01" }), { kind: "update", id: 5 });
  assert.throws(() => planProductCostChange(open, { ...input, startsAt: "2026-05-01" }), /01\/06\/2026/);
  assert.equal(totalCostCents({ materialCents: 1500, laborCents: 500, freightCents: 150 }), 2150);
});

test("lucro sobre o custo é (preço - custo) / custo", () => {
  assert.ok(TARGET_PROFIT_ON_COST > 0 && TARGET_PROFIT_ON_COST < 1);
  assert.equal(profitOnCost(3000, 2000), 0.5);
  assert.equal(profitOnCost(1800, 2000), -0.1);
  assert.equal(profitOnCost(3000, 0), null);
});

test("códigos antigos e novos da mesma peça são equivalentes", () => {
  assert.equal(normalizePieceCode("RN 180"), "RN180");
  assert.equal(normalizePieceCode("PF-RN-180"), "RN180");
  assert.equal(normalizePieceCode("pf-gr-188"), normalizePieceCode("GR 188"));
});

test("lucro das vendas usa o custo da data e separa vendas sem custo", () => {
  const products = [
    { id: 4, code: "PF-AA-100" },
    { id: 2, code: "PF-BB-200" },
    { id: 16, code: "PF-CC-300" },
  ];
  const history = [
    row({ id: 1, productId: 4, unitCostCents: 2900 }),
    row({ id: 2, productId: 2, unitCostCents: 2000 }),
  ];
  const summary = summarizeSalesProfit(
    [
      { code: "AA 100", quantity: 100, revenueCents: 300000, date: "2026-09-28" },
      { code: "PF-BB-200", quantity: 100, revenueCents: 280000, date: "2026-10-27" },
      { code: "PF-CC-300", quantity: 10, revenueCents: 5000, date: "2026-10-27" },
      { code: "PF-BB-200", quantity: 1, revenueCents: 2800, date: "2026-05-01" },
    ],
    products,
    history,
  );
  assert.equal(summary.revenueCents, 300000 + 280000 + 5000 + 2800);
  assert.equal(summary.uncoveredRevenueCents, 5000 + 2800);
  assert.equal(summary.costCents, 290000 + 200000);
  assert.equal(summary.profitCents, 10000 + 80000);
  assert.deepEqual(summary.byProduct.map((item) => item.code), ["PF-BB-200", "PF-AA-100", "PF-CC-300"]);
  assert.equal(summary.byProduct[0].quantity, 101);
  assert.equal(summary.byProduct[1].profitCents, 10000);
  assert.equal(summary.byProduct[2].profitCents, null);
});

test("API grava e devolve custo nos dois caminhos de banco", () => {
  assert.equal(catalogApi.split("productCosts: await listProductCostsSafe()").length - 1, 2);
  assert.equal(catalogApi.split("parseProductCostInput(body.cost, todayIso())").length - 1, 4);
  assert.equal(catalogApi.split("saveProductCosts(").length - 1, 5);
  assert.equal(catalogApi.split('parseProductCostInput(body.purchaseCost, todayIso(), "comprada")').length - 1, 4);
  assert.ok(catalogApi.includes("error instanceof ProductCostError"));
  assert.ok(costStore.includes("hasSupabaseRest()"));
  assert.ok(costStore.includes('supabaseInsert("product_cost_history"'));
  assert.ok(costStore.includes("tx.insert(productCostHistory)"));
});

test("custo nunca vai para o catálogo público", () => {
  assert.equal(/cost/i.test(publicCatalog), false);
  assert.equal(/product_cost_history|productCost/.test(read("../app/catalogo/page.tsx")), false);
});

test("tela mostra custo nas peças e lucro no financeiro", () => {
  // lista de Peças: preço, custo em uso com a origem, lucro e estoque
  assert.ok(page.includes('<span>Peça</span><span>Tipo / Linha</span><span>Preço</span><span>Custo</span><span>Lucro</span><span>Estoque</span><span>Status</span>'));
  assert.ok(page.includes('costSourceOf(cost.source) === "comprada" ? "revenda" : "fabricação"'));
  assert.ok(page.includes('className="piece-row"'));
  assert.ok(page.includes('costField("costMaterial"'));
  assert.ok(page.includes('name="costStartsAt"'));
  assert.ok(page.includes("...(costChanged ? { cost } : {})"));
  assert.ok(page.includes("salesProfit.byProduct"));
});

test("preço em centavos da peça é gravado junto com o preço, nos dois caminhos de banco", () => {
  assert.ok(catalogApi.includes("priceCents: Math.round(price * 100)"));
  assert.ok(catalogApi.includes("changes.priceCents = Math.round(changes.price * 100)"));
  assert.ok(catalogApi.includes("price_cents: Math.round(price * 100),"));
  assert.ok(catalogApi.includes("changes.price_cents = Math.round(price * 100)"));
});

test("peça tem um custo fabricando e outro comprando pronta, cada um com o próprio histórico", () => {
  const history = [
    row({ id: 1, unitCostCents: 2000, startsAt: "2026-06-01", source: "fabricada" }),
    row({ id: 2, unitCostCents: 3000, startsAt: "2026-11-11", source: "comprada", supplier: "Fornecedor A" }),
  ];
  // vale a origem que começou por último
  assert.equal(costAt(history, 7, "2026-11-10").id, 1);
  assert.equal(costAt(history, 7, "2026-11-11").id, 2);
  assert.equal(costOfSourceAt(history, 7, "fabricada", "2026-11-12").id, 1);
  assert.equal(costOfSourceAt(history, 7, "comprada", "2026-11-12").id, 2);
  assert.equal(costOfSourceAt(history, 7, "comprada", "2026-11-10"), null);
  assert.equal(openCost(history, 7).id, 1);
  assert.equal(openCost(history, 7, "comprada").id, 2);
  // no mesmo dia, a comprada vence
  const sameDay = [row({ id: 1, source: "fabricada" }), row({ id: 2, source: "comprada" })];
  assert.equal(costAt(sameDay, 7, "2026-06-01").id, 2);

  assert.equal(costSourceOf("comprada"), "comprada");
  assert.equal(costSourceOf(undefined), "fabricada");
  assert.equal(Object.keys(COST_SOURCE_LABEL).length, 2);

  const parsed = parseProductCostInput({ materialCents: 3000, supplier: "  Fornecedor A  " }, "2026-11-11", "comprada");
  assert.equal(parsed.source, "comprada");
  assert.equal(parsed.supplier, "Fornecedor A");

  // só o fornecedor mudou: corrige a vigência atual
  const open = row({ id: 9, source: "comprada", supplier: "Fornecedor A" });
  const same = { materialCents: 1500, laborCents: 500, freightCents: 0, startsAt: "2026-06-01", source: "comprada" };
  assert.deepEqual(planProductCostChange(open, { ...same, supplier: "Fornecedor B" }), { kind: "update", id: 9 });
  assert.deepEqual(planProductCostChange(open, { ...same, supplier: "Fornecedor A" }), { kind: "none" });

  assert.ok(costStore.includes("openCost(await listProductCosts(productId), productId, input.source)"));
  // a data de início salva volta no campo ao editar e é gravada quando muda
  assert.ok(page.includes('name="costStartsAt" defaultValue={cost?.startsAt || todayIso()}'));
  assert.ok(page.includes('name="purchaseStartsAt" defaultValue={purchase?.startsAt || todayIso()}'));
  assert.ok(page.includes("savedCost.startsAt !== cost.startsAt"));
  assert.ok(costStore.includes("{ ...restValues, starts_at: input.startsAt }"));
  assert.ok(page.includes("<legend>Custo revenda</legend>"));
  assert.ok(page.includes("...(purchaseChanged ? { purchaseCost } : {})"));
  assert.ok(/add column if not exists source/i.test(read("../supabase/migrations/20261113030000_product_cost_source.sql")));
});

test("custo em uso é escolhido na peça, com data, e vale para todo o sistema", () => {
  const history = [
    row({ id: 1, unitCostCents: 2000, startsAt: "2026-06-01", source: "fabricada" }),
    row({ id: 2, unitCostCents: 3000, startsAt: "2026-11-11", source: "comprada" }),
  ];
  const use = (values) => ({ id: 1, productId: 7, source: "fabricada", startsAt: "2026-11-01", ...values });

  // sem escolha: regra antiga (o custo que começou por último)
  assert.equal(costAt(history, 7, "2026-11-12").id, 2);
  // escolha de fabricação mantém o custo de fabricação, mesmo com revenda cadastrada depois
  const uses = [use({ id: 1, source: "fabricada", startsAt: "2026-11-01" }), use({ id: 2, source: "comprada", startsAt: "2026-12-01" })];
  assert.equal(costAt(history, 7, "2026-11-12", uses).id, 1);
  assert.equal(costAt(history, 7, "2026-12-01", uses).id, 2);
  // antes da primeira escolha, segue a regra antiga
  assert.equal(costAt(history, 7, "2026-10-01", uses).id, 1);
  // escolha de outra peça não interfere
  assert.equal(costAt(history, 7, "2026-11-12", [use({ productId: 8 })]).id, 2);
  // origem escolhida sem custo cadastrado: usa o que houver
  assert.equal(costAt([history[0]], 7, "2026-12-05", uses).id, 1);

  assert.equal(costUseAt(uses, 7, "2026-11-15").id, 1);
  assert.equal(costUseAt(uses, 7, "2026-10-15"), null);
  assert.equal(latestCostUse(uses, 7).id, 2);
  assert.equal(latestCostUse(uses, 99), null);

  const latest = use({ id: 5, source: "comprada", startsAt: "2026-11-11" });
  assert.deepEqual(planCostUseChange(null, { source: "fabricada", startsAt: "2026-11-13" }), { kind: "insert" });
  assert.deepEqual(planCostUseChange(latest, { source: "comprada", startsAt: "2026-11-11" }), { kind: "none" });
  assert.deepEqual(planCostUseChange(latest, { source: "comprada", startsAt: "2026-11-05" }), { kind: "update", id: 5 });
  assert.deepEqual(planCostUseChange(latest, { source: "fabricada", startsAt: "2026-11-11" }), { kind: "update", id: 5 });
  assert.deepEqual(planCostUseChange(latest, { source: "fabricada", startsAt: "2026-11-20" }), { kind: "insert" });
  assert.throws(() => planCostUseChange(latest, { source: "fabricada", startsAt: "2026-11-01" }), /11\/11\/2026/);

  assert.equal(parseCostUseInput(undefined, "2026-11-13"), null);
  assert.deepEqual(parseCostUseInput({ source: "fabricada" }, "2026-11-13"), { source: "fabricada", startsAt: "2026-11-13" });
  assert.throws(() => parseCostUseInput({ source: "outra" }, "2026-11-13"), ProductCostError);
  assert.throws(() => parseCostUseInput({ source: "comprada", startsAt: "13/11/2026" }, "2026-11-13"), ProductCostError);

  // lucro das vendas respeita a escolha na data de cada venda
  const summary = summarizeSalesProfit(
    [
      { code: "PF-AA-100", quantity: 1, revenueCents: 5000, date: "2026-11-12" },
      { code: "PF-AA-100", quantity: 1, revenueCents: 5000, date: "2026-12-02" },
    ],
    [{ id: 7, code: "PF-AA-100" }],
    history,
    uses,
  );
  assert.equal(summary.costCents, 2000 + 3000);

  assert.equal(catalogApi.split("parseCostUseInput(body.costUse, todayIso())").length - 1, 4);
  assert.equal(catalogApi.split("saveCostUse(").length - 1, 4);
  assert.equal(catalogApi.split("productCostUses: await listCostUsesSafe()").length - 1, 2);
  // "Custo em uso" fica dentro de cada custo (Sim/Não), na edição e na visualização
  assert.equal(page.includes("<legend>Custo em uso</legend>"), false);
  assert.ok(page.includes('<input type="hidden" name="costUseSource" value={draft.source} />'));
  assert.ok(page.includes('{costUseFields("comprada")}') && page.includes('{costUseFields("fabricada")}'));
  assert.ok(page.includes('const next = e.target.value === "sim" ? source : other;'));
  assert.equal(page.split('label="Custo em uso"').length - 1, 3);
  assert.ok(page.includes("costAt(productCosts, productId, todayIso(), productCostUses)"));
  assert.ok(/create table if not exists public\.product_cost_in_use/i.test(read("../supabase/migrations/20261113050000_product_cost_in_use.sql")));
});
