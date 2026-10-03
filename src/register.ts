/**
 * createPasswordReset / registerPasswordReset - build the def set, and install it.
 *
 * `createPasswordReset(opts)` builds. `registerPasswordReset(xano, opts)` builds AND
 * registers, and RETURNS the def set - never void. That returned handle is the
 * consumer's only route to the registered defs, because a factory module has no
 * module-level export to import.
 *
 * The WeakSet is not redundant with core's duplicate-def guard. Core compares
 * def IDENTITY, so two `createPasswordReset()` calls produce two distinct def
 * objects that share names, slip past it, and detonate at `export()` as
 * `Duplicate object guid … shared by "dbo/x" and "dbo/x"` - naming neither
 * call site. The guard turns that into a sentence naming this function.
 */
import type { Xano } from "@xano/sdk";
import { resolveOptions, type PasswordResetOptions } from "./options.js";
import { createResetTokenTable } from "./tables/reset-token.js";
import { createPasswordResetGroup } from "./api/group.js";
import { createRequestResetQuery } from "./api/request.js";
import { createConfirmResetQuery } from "./api/confirm.js";
import { createValidateResetQuery } from "./api/validate.js";

const installed = new WeakSet<Xano>();

/** Everything one createPasswordReset() call minted. */
export interface PasswordResetDefs {
  tokenTable: ReturnType<typeof createResetTokenTable>;
  group: ReturnType<typeof createPasswordResetGroup>;
  requestQuery: ReturnType<typeof createRequestResetQuery>;
  confirmQuery: ReturnType<typeof createConfirmResetQuery>;
  validateQuery: ReturnType<typeof createValidateResetQuery>;
}

/** Build the def set without registering it. Two calls are fully independent. */
export function createPasswordReset(options: PasswordResetOptions): PasswordResetDefs {
  const resolved = resolveOptions(options);
  const tokenTable = createResetTokenTable(resolved.authTable);
  const group = createPasswordResetGroup(resolved);
  return {
    tokenTable,
    group,
    requestQuery: createRequestResetQuery(group, tokenTable, resolved),
    confirmQuery: createConfirmResetQuery(group, tokenTable, resolved),
    validateQuery: createValidateResetQuery(group, tokenTable, resolved),
  };
}

/**
 * Build the def set, register it onto `xano`, and hand it back.
 *
 * The consumer's auth table is NOT registered here. This module points at it;
 * it does not own it, and registering someone else's table would make the two
 * registrations collide.
 */
export function registerPasswordReset(xano: Xano, options: PasswordResetOptions): PasswordResetDefs {
  if (installed.has(xano)) {
    throw new Error(
      "registerPasswordReset: already installed on this Xano instance. A second call registers a " +
        "second def set with the same names, which fails at export() naming neither call site. " +
        "Call it once and keep the returned defs.",
    );
  }
  const defs = createPasswordReset(options);
  xano
    .registerTables([defs.tokenTable])
    .registerApiGroups([defs.group])
    .registerQueries([defs.requestQuery, defs.confirmQuery, defs.validateQuery]);
  installed.add(xano);
  return defs;
}
