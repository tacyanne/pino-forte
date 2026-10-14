import assert from "node:assert/strict";
import test from "node:test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Execute the real route and session authorization. Only database I/O is fake.
// No environment credential, real fetch, or database connection is used.
const runtime = new URL("../.sites-runtime/", import.meta.url);
await mkdir(runtime, { recursive: true });
await build({
  entryPoints: ["app/api/orders/route.ts"],
  outfile: fileURLToPath(new URL("orders-delete.mjs", runtime)),
  bundle: true, platform: "node", format: "esm", packages: "external",
  plugins: [{
    name: "isolated-database",
    setup(build) {
      build.onResolve({ filter: /^(\.\.\/)+db$/ }, () => ({ path: "db", namespace: "fake" }));
      build.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: `
        export const getDb = async () => globalThis.__ordersDeleteTest.getDb();
        export const getSql = async () => globalThis.__ordersDeleteTest.getSql();
      ` }));
    },
  }],
});
const { DELETE } = await import(new URL("orders-delete.mjs", runtime));

for (const adapter of ["rest", "postgres"]) {
  for (const scenario of [
    { name: "anonymous", status: 401 },
    { name: "expired session", user: "admin", expired: true, status: 401 },
    { name: "inactive admin", user: "admin", inactive: true, status: 401 },
    { name: "ordinary user", user: "user", confirm: true, status: 403 },
    { name: "unknown role", user: "ADMIN", confirm: true, status: 403 },
    { name: "admin without confirmation", user: "admin", status: 400 },
    { name: "admin explicit confirmation", user: "admin", confirm: true, status: 200 },
    { name: "financial foreign key conflict", user: "admin", confirm: true, linked: true, status: 409 },
    { name: "database failure", user: "admin", confirm: true, failure: true, status: 500 },
  ]) {
    test(`${adapter}: ${scenario.name}`, async (t) => {
      const savedEnv = { ...process.env };
      const savedFetch = globalThis.fetch;
      t.after(() => { process.env = savedEnv; globalThis.fetch = savedFetch; delete globalThis.__ordersDeleteTest; });
      for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "DATABASE_URL", "SUPABASE_DATABASE_URL"])
        delete process.env[key];
      if (adapter === "rest") {
        process.env.SUPABASE_URL = "https://orders-test.invalid";
        process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
      }
      let attempts = 0;
      let deleted = 0;
      const user = { id: 1, role: scenario.user, active: !scenario.inactive };
      globalThis.__ordersDeleteTest = {
        getSql: () => async (strings) => {
          assert.match(strings.join("?"), /u\.active = true/);
          assert.match(strings.join("?"), /s\.expires_at::timestamp > CURRENT_TIMESTAMP/);
          return scenario.expired || scenario.inactive ? [] : [user];
        },
        getDb: () => {
          assert.equal(adapter, "postgres");
          assert.equal(scenario.status >= 200 && scenario.status !== 400 && scenario.status !== 403 && scenario.status !== 401, true);
          return { delete: async () => {
            attempts++;
            if (scenario.linked) throw new Error("private database details", { cause: { code: "23503" } });
            if (scenario.failure) throw new Error("private database details");
            deleted++;
          } };
        },
      };
      globalThis.fetch = async (input, options) => {
        assert.equal(adapter, "rest");
        const url = new URL(input);
        assert.equal(url.origin, "https://orders-test.invalid");
        if (url.pathname === "/rest/v1/app_sessions")
          return Response.json([{ userId: 1, expiresAt: scenario.expired ? "2000-01-01" : "2099-01-01" }]);
        if (url.pathname === "/rest/v1/app_users") {
          assert.equal(url.searchParams.get("active"), "eq.true");
          return Response.json(scenario.inactive ? [] : [user]);
        }
        assert.equal(url.pathname, "/rest/v1/service_orders");
        assert.equal(options.method, "DELETE");
        assert.equal(url.searchParams.get("id"), "gte.0");
        attempts++;
        if (scenario.linked) return Response.json({ code: "23503", message: "private database details" }, { status: 409 });
        if (scenario.failure) return Response.json({ message: "private database details" }, { status: 500 });
        deleted++;
        return new Response(null, { status: 204 });
      };
      const headers = {};
      if (scenario.user) headers.cookie = "pino_session=fictitious";
      if (scenario.confirm) headers["x-confirm-delete-orders"] = "delete-all";
      const response = await DELETE(new Request("https://orders-test.invalid/api/orders", { method: "DELETE", headers }));
      assert.equal(response.status, scenario.status);
      assert.equal(attempts, [200, 409, 500].includes(scenario.status) ? 1 : 0);
      assert.equal(deleted, scenario.status === 200 ? 1 : 0);
      assert.doesNotMatch(await response.text(), /private database details/);
    });
  }
}
