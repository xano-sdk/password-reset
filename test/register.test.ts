/**
 * The install contract: one call puts everything on the workspace, and a second
 * call on the same instance is refused HERE.
 *
 * Core's duplicate-def guard compares def IDENTITY, so two createPasswordReset()
 * calls produce distinct objects sharing names, slip past it, and detonate at
 * export() as "Duplicate object guid … shared by …" - naming neither call site.
 */
import { describe, it, expect } from "vitest";
import { Xano } from "@xano/sdk";
import { createPasswordReset, registerPasswordReset } from "../src/index.js";
import { baseOptions, testAuthTable } from "./helpers.js";

const freshWorkspace = () =>
  new Xano().registerWorkspace({ name: "xts-password-reset-register" }).registerTables([testAuthTable]);

describe("registerPasswordReset", () => {
  it("registers the table, the group and all three endpoints in one call", () => {
    const xano = freshWorkspace();
    registerPasswordReset(xano, { ...baseOptions, canonical: "password_reset" });
    const bundle = xano.export() as any;
    expect(bundle.payload.dbo.map((t: any) => t.name)).toContain("password_reset_token");
    expect(bundle.payload.app).toHaveLength(1);
    expect(bundle.payload.query.map((q: any) => q.name).sort()).toEqual([
      "password_reset/confirm",
      "password_reset/request",
      "password_reset/validate",
    ]);
  });

  it("does NOT register the consumer's auth table", () => {
    const xano = new Xano().registerWorkspace({ name: "xts-password-reset-register-solo" });
    const defs = registerPasswordReset(xano, baseOptions);
    // This module points at that table; it does not own it. Registering it here
    // would collide with the consumer's own registration - so the ONE table
    // this call adds is its own.
    expect(defs.tokenTable.name).toBe("password_reset_token");
    // And core refuses to export until the consumer registers the table this
    // module references, which is the behaviour a consumer should see rather
    // than a dangling guid that only fails at deploy.
    expect(() => xano.export()).toThrow(/test_user.*not registered/s);
  });

  it("returns the def set, so the consumer can reach the registered defs", () => {
    const xano = freshWorkspace();
    const defs = registerPasswordReset(xano, baseOptions);
    // A factory module has no module-level export - this handle is the ONLY route.
    expect(defs.tokenTable).toBeDefined();
    expect(defs.group).toBeDefined();
    expect(defs.requestQuery).toBeDefined();
    expect(defs.confirmQuery).toBeDefined();
    expect(defs.validateQuery).toBeDefined();
  });

  it("refuses a second install on the same instance, by name", () => {
    const xano = freshWorkspace();
    registerPasswordReset(xano, baseOptions);
    expect(() => registerPasswordReset(xano, baseOptions)).toThrow(/registerPasswordReset/);
  });

  it("validates before it registers anything", () => {
    const xano = freshWorkspace();
    expect(() => registerPasswordReset(xano, { ...baseOptions, resetUrl: "javascript:alert(1)" })).toThrow(
      /resetUrl/,
    );
    // A rejected install must leave the instance untouched, and must not burn
    // the one-install-per-instance budget.
    expect((xano.export() as any).payload.app).toHaveLength(0);
    expect(() => registerPasswordReset(xano, baseOptions)).not.toThrow();
  });

  it("mints fully independent def sets across two create calls", () => {
    const a = createPasswordReset(baseOptions);
    const b = createPasswordReset(baseOptions);
    // Nothing to reconcile between calls is the whole point of the shape: no
    // canonical-agreement guard, no history-agreement guard, no shared state.
    expect(a.tokenTable).not.toBe(b.tokenTable);
    expect(a.group).not.toBe(b.group);
  });

  it("installs onto two separate instances independently", () => {
    const first = freshWorkspace();
    const second = freshWorkspace();
    expect(() => {
      registerPasswordReset(first, baseOptions);
      registerPasswordReset(second, baseOptions);
    }).not.toThrow();
  });
});
