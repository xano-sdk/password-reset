/**
 * Shared fixtures and bundle introspection.
 *
 * Two rules govern this file:
 *
 * 1. Each shared fixture table is declared ONCE, here. Two `table()` defs with
 *    the same name derive the same guid and trip core's duplicate guard the
 *    moment two tests register into one workspace.
 * 2. Nothing here imports `@xano/sdk/internal`. That subpath is compiler
 *    machinery the peer window makes no promise about, so importing it would
 *    tie the SUITE to one SDK version and could make it raise the peer floor.
 *    `deriveGuid` is recomputed locally instead, which is safe because the
 *    golden fixture freezes every literal guid independently.
 */
import { createHash } from "node:crypto";
import { Xano, table, f } from "@xano/sdk";
import { createPasswordReset, type PasswordResetOptions } from "../src/index.js";

/** The consumer-side auth table every test points this module at. */
export const testAuthTable = table({
  name: "test_user",
  auth: true,
  useXdo: false,
  schema: {
    email: f.email({ required: true }),
    password: f.password({ required: true }),
  },
  index: [{ type: "unique", fields: [{ name: "email" }] }],
});

/**
 * A second auth table, whose address and hash columns are NOT named `email`
 * and `password`.
 *
 * Declared here rather than inline in a test: two `table()` defs with the same
 * name derive the same guid, so a per-test copy would collide the moment two
 * tests register into one workspace.
 */
export const renamedColumnAuthTable = table({
  name: "test_member",
  auth: true,
  useXdo: false,
  schema: {
    login_email: f.email({ required: true }),
    pass_hash: f.password({ required: true }),
  },
  index: [{ type: "unique", fields: [{ name: "login_email" }] }],
});

/** The minimum a consumer must pass. Spread it and override the one option under test. */
export const baseOptions: PasswordResetOptions = {
  authTable: testAuthTable,
  resetUrl: "https://app.example.com/reset",
  fromEmail: "no-reply@example.com",
};

/**
 * The identity core derives with no lock: `md5("<kind>:<name>")`.
 *
 * Recomputed rather than imported - see rule 2 above.
 */
export const deriveGuid = (kind: string, name: string): string =>
  createHash("md5").update(`${kind}:${name}`).digest("hex");

/** A query's identity carries its group and verb, which is the engine's own rule. */
export const deriveQueryGuid = (group: string, verb: string, name: string): string =>
  deriveGuid("query", `${group}|${verb}|${name}`);

/** The opaque exported bundle, typed loosely because it IS opaque. */
export interface Bundle {
  payload: {
    dbo: any[];
    app: any[];
    query: any[];
    function: any[];
    [key: string]: any;
  };
  [key: string]: any;
}

/** A fresh workspace with this module installed, exported. */
export function exportWithModule(overrides: Partial<PasswordResetOptions> = {}): Bundle {
  const xano = new Xano().registerWorkspace({ name: "xts-password-reset-test" });
  const options = { ...baseOptions, canonical: "password_reset", ...overrides };
  const defs = createPasswordReset(options);
  xano
    // The module points at the auth table; it does not own it, so the harness
    // registers it the way a consumer would.
    .registerTables([options.authTable, defs.tokenTable])
    .registerApiGroups([defs.group])
    .registerQueries([defs.requestQuery, defs.confirmQuery, defs.validateQuery]);
  // A double assertion: the exported bundle's type is core's own, and it does
  // not structurally overlap the loose shape these tests introspect it through.
  return xano.export() as unknown as Bundle;
}

/** One table object out of the bundle, by name. Throws rather than returning undefined. */
export function tableIn(bundle: Bundle, name: string): any {
  const found = bundle.payload.dbo.find((t: any) => t.name === name);
  if (!found) {
    throw new Error(
      `No table "${name}" in the bundle. Present: ${bundle.payload.dbo.map((t: any) => t.name).join(", ")}`,
    );
  }
  return found;
}

/** One query object out of the bundle, by verb and name. */
export function queryIn(bundle: Bundle, verb: string, name: string): any {
  const found = bundle.payload.query.find((q: any) => q.name === name && q.verb?.toUpperCase() === verb);
  if (!found) {
    throw new Error(
      `No ${verb} "${name}" in the bundle. Present: ` +
        bundle.payload.query.map((q: any) => `${q.verb} ${q.name}`).join(", "),
    );
  }
  return found;
}

/** One column out of a table object, by name. */
export const columnIn = (tableObject: any, name: string): any =>
  tableObject.schema.find((c: any) => c.name === name);

/** Every statement in a query's stack whose engine name matches. */
export const statementsNamed = (queryObject: any, storedName: string): any[] =>
  (queryObject.run ?? []).filter((stmt: any) => stmt.name === storedName);
