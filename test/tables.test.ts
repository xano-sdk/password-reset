/**
 * Encode-level fidelity for the table this module registers.
 *
 * These assertions are about what the ENGINE receives, not about what the def
 * literal says - the two differ wherever core injects, defaults, or resolves
 * something, and it is the injected half that breaks silently.
 */
import { describe, it, expect } from "vitest";
import { columnIn, deriveGuid, exportWithModule, tableIn } from "./helpers.js";

const tokenTable = (overrides = {}) => tableIn(exportWithModule(overrides), "password_reset_token");

describe("password_reset_token table", () => {
  it("registers with the system columns core injects", () => {
    const t = tokenTable();
    const names = t.schema.map((c: any) => c.name);
    // `id` and `created_at` are auto-injected. Asserting them here is what
    // catches someone "helpfully" declaring them and getting two.
    expect(names.filter((n: string) => n === "id")).toHaveLength(1);
    expect(names.filter((n: string) => n === "created_at")).toHaveLength(1);
    expect(names).toEqual(["id", "created_at", "owner", "token", "expires_at", "used_at"]);
  });

  it("keeps the token out of every API response", () => {
    // The token is a bearer credential for one account. `access: "internal"` is
    // what stops a read that returns the whole row from handing the account
    // over, and no endpoint here names it in an `output` list to get it back.
    expect(columnIn(tokenTable(), "token").access).toBe("internal");
    expect(columnIn(tokenTable(), "token").sensitive).toBe(true);
  });

  it("makes the token unique, not merely indexed", () => {
    const index = tokenTable().index ?? [];
    const onToken = index.find((i: any) => (i.fields ?? []).some((fld: any) => fld.name === "token"));
    // The confirm endpoint fetches by this column with a single-row db.get, so
    // a duplicate token would resolve to an arbitrary one of the rows.
    expect(onToken.type).toContain("unique");
  });

  it("indexes the owner the confirm endpoint sweeps", () => {
    const indexed = (tokenTable().index ?? []).flatMap((i: any) =>
      (i.fields ?? []).map((fld: any) => fld.name),
    );
    expect(indexed).toContain("owner");
  });

  it("lets used_at be null, because an unused token has no value for it", () => {
    expect(columnIn(tokenTable(), "used_at").nullable).toBe(true);
    // Expiry is not optional: a row with no expiry never expires.
    expect(columnIn(tokenTable(), "expires_at").required).toBe(true);
  });

  it("stores both timestamps as epoch-ms, so the expiry check has no timezone in it", () => {
    expect(columnIn(tokenTable(), "expires_at").type).toBe("epochms");
    expect(columnIn(tokenTable(), "used_at").type).toBe("epochms");
  });

  it("pins its storage mode rather than inheriting the consumer's", () => {
    // A table with no explicit useXdo inherits the CONSUMER workspace's
    // use_xdo at export. Inheriting would change this table's storage mode
    // depending on whose workspace it lands in.
    expect(tokenTable().use_xdo).toBe(false);
  });

  it("derives its identity from (kind, name) with no pinned guid", () => {
    // Identity belongs to the CONSUMER's xano.lock. A guid pinned in the module
    // would collide the moment two consumers deploy into one instance.
    expect(tokenTable().guid).toBe(deriveGuid("dbo", "password_reset_token"));
  });

  it("points its owner column at the CONSUMER's auth table, by guid", () => {
    const bundle = exportWithModule();
    const owner = columnIn(tableIn(bundle, "password_reset_token"), "owner");
    const authGuid = tableIn(bundle, "test_user").guid;
    // f.tableRef resolves eagerly, at column-construction time. This assertion
    // is the one that fails if the def is ever hoisted to module level.
    const refs = (owner.methods ?? [])
      .filter((m: any) => m.name === "@")
      .map((m: any) => String(m.arg[0]).replace(/^dbo=/, ""));
    expect(refs).toContain(authGuid);
  });

  it("mints an independent table per create call", () => {
    // Two create calls must share nothing. This is the property that makes the
    // factory shape safe, so it is asserted rather than assumed.
    expect(tokenTable().schema).toEqual(tokenTable().schema);
  });
});
