import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { jsPDF } from "jspdf";
import {
  fetchCatalogProducts,
  watchCatalogUpdates,
  notifyCatalogUpdate,
  CATALOG_CHANNEL,
} from "../lib/catalog-sync.ts";
import {
  drawCatalogPdfDetails,
  catalogPdfDetails,
} from "../lib/catalog-product-pdf.ts";

const runtime = new URL("../.sites-runtime/", import.meta.url);
await mkdir(runtime, { recursive: true });
for (const [name, entry] of [
  ["catalog-view", "app/catalogo/catalog-view.tsx"],
  ["catalog-api", "app/api/catalog/products/route.ts"],
  ["catalog-edit", "app/api/catalog/route.ts"],
]) {
  await build({
    entryPoints: [entry],
    outfile: new URL(`${name}.mjs`, runtime).pathname.replace(
      /^\/([A-Za-z]:)/,
      "$1",
    ),
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
  });
}
const { CatalogView } = await import(new URL("catalog-view.mjs", runtime));
const { GET } = await import(new URL("catalog-api.mjs", runtime));
const { PATCH } = await import(new URL("catalog-edit.mjs", runtime));

test("one saved description is reread by both online catalogs and all four PDF styles", async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://catalog-test.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const row = {
    id: 27,
    code: "TEST 27",
    piece_type: "Bucha",
    name: "Descricao anterior",
    measure: "Aplicacao especial",
    price: 91,
    active: true,
    image_data: "",
  };
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/rest/v1/app_sessions")
      return Response.json([{ userId: 1, expiresAt: "2099-01-01T00:00:00Z" }]);
    if (path === "/rest/v1/app_users")
      return Response.json([{ id: 1, role: "admin", active: true }]);
    if (path === "/rest/v1/piece_lines") return Response.json([{id:1,name:"Descricao anterior",active:true},{id:2,name:"Descricao atualizada",active:true}]);
    assert.equal(new URL(url).pathname, "/rest/v1/products");
    if (options.method === "PATCH") {
      if (new URL(url).searchParams.get("id") !== "eq.27")
        return Response.json([]);
      Object.assign(row, JSON.parse(options.body));
      return Response.json([row]);
    }
    assert.equal(new URL(url).searchParams.get("active"), "eq.true");
    assert.equal(options.cache, "no-store");
    return Response.json([row]);
  };
  try {
    assert.equal(
      (await (await GET()).json()).products[0].name,
      "Descricao anterior",
    );
    const edit = (id) =>
      PATCH(
        new Request("https://catalog-test.invalid/api/catalog", {
          method: "PATCH",
          headers: {
            cookie: "pino_session=test-session",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type: "product",
            id,
            name: "Descricao atualizada",
          }),
        }),
      );
    const saved = await edit(27);
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).product.name, "Descricao atualizada");
    assert.equal((await edit(999)).status, 404);
    assert.equal(
      (
        await PATCH(
          new Request("https://catalog-test.invalid/api/catalog", {
            method: "PATCH",
          }),
        )
      ).status,
      401,
    );
    for (const distributor of [false, true]) {
      const response = await GET();
      assert.match(response.headers.get("cache-control"), /no-store/);
      const { products } = await response.json();
      const html = renderToStaticMarkup(
        createElement(CatalogView, { initialProducts: products, distributor }),
      );
      assert.match(html, /Descricao atualizada/);
      assert.match(html, /Bucha/);
      assert.doesNotMatch(html, /Descricao anterior|COMUM|Pino de balança/);
      assert.equal(products[0].price, 91);
      if (distributor) assert.match(html, /Regra de desconto/);
      for (const color of [false, true]) {
        const pdf = new jsPDF();
        pdf.setTextColor(color ? 255 : 35);
        drawCatalogPdfDetails(pdf, products[0], 20, 20);
        assert.match(pdf.output(), /Descricao atualizada/);
        assert.match(pdf.output(), /Bucha/);
        assert.doesNotMatch(pdf.output(), /Descricao anterior|COMUM/);
      }
    }
    // Reopening obtains the persisted value again, rather than an old in-memory copy.
    assert.equal((await (await GET()).json()).products[0].name, row.name);
    row.name =
      "Uma descricao longa que deve aparecer integralmente mesmo quando ocupar varias linhas no catalogo exportado";
    assert.ok(
      catalogPdfDetails(new jsPDF(), { ...row, pieceType: row.piece_type })
        .height > 50,
    );
    globalThis.fetch = async () =>
      new Response("Database unavailable", { status: 503 });
    assert.equal((await GET()).status, 500);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test("failed or malformed fresh reads cannot silently export stale descriptions", async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.cache, "no-store");
      return Response.json({ products: [{ name: "Current" }] });
    };
    assert.equal((await fetchCatalogProducts())[0].name, "Current");
    for (const response of [
      Response.json({ error: "failed" }, { status: 500 }),
      Response.json({}),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(fetchCatalogProducts, /Não foi possível atualizar/);
    }
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("open catalogs refresh on saves, focus and cross-device polling; cleanup stops refreshes", () => {
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    BroadcastChannel: globalThis.BroadcastChannel,
  };
  const channels = [];
  class Channel extends EventTarget {
    constructor() {
      super();
      channels.push(this);
    }
    postMessage() {
      for (const other of channels)
        if (other !== this && !other.closed)
          other.dispatchEvent(new Event("message"));
    }
    close() {
      this.closed = true;
    }
  }
  let tick;
  let cleared = false;
  globalThis.window = Object.assign(new EventTarget(), {
    setInterval(callback, ms) {
      assert.equal(ms, 15000);
      tick = callback;
      return 1;
    },
    clearInterval() {
      cleared = true;
    },
  });
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.BroadcastChannel = Channel;
  try {
    let count = 0;
    const stop = watchCatalogUpdates(() => count++);
    notifyCatalogUpdate();
    assert.equal(count, 2);
    window.dispatchEvent(new Event("focus"));
    tick();
    assert.equal(count, 4);
    document.hidden = true;
    tick();
    assert.equal(count, 4);
    stop();
    window.dispatchEvent(new Event(CATALOG_CHANNEL));
    assert.equal(count, 4);
    assert.equal(cleared, true);
    assert.equal(channels[0].closed, true);
  } finally {
    Object.assign(globalThis, original);
  }
});
