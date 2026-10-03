/**
 * POST `password_reset/confirm` - spend a token and set the new password.
 *
 * Every rejection - unknown token, already spent, expired - returns the SAME
 * message and the same status. The differences are real, but telling a caller
 * which one applies turns the endpoint into an oracle about tokens it does not
 * hold, and the person who legitimately clicked a stale link is told to request
 * a new one either way.
 */
import {
  query,
  s,
  c,
  ref,
  inp,
  col,
  expr,
  input,
  type ApiGroupDef,
  type TableDef,
} from "@xano/sdk";
import type { ResolvedPasswordResetOptions } from "../options.js";
import { rateLimitStatement } from "./rate-limit.js";

/** One message for all three rejections. See the header comment. */
const REJECTION = "This reset link is not valid. Request a new one.";

export const createConfirmResetQuery = (
  group: ApiGroupDef,
  tokenTable: TableDef,
  options: ResolvedPasswordResetOptions,
) =>
  query({
    name: "password_reset/confirm",
    verb: "POST",
    apiGroup: group,
    // No `auth`: the caller is by definition someone who cannot log in.
    description: "Set a new password using a token from a reset email.",
    input: {
      token: input.text({ required: true }),
      // `input.text`, NOT `input.password`. An `input.password` hashes at BIND
      // time, so the `f.password()` column would then see a value already in
      // `salt.hash` shape, skip its own hash-on-write, and store it verbatim -
      // and the plaintext the user typed would never be what login compares
      // against. The COLUMN does the hashing; this input carries plaintext.
      password: input.text({ required: true, methods: ["min:8"] }),
    },
    stack: [
      rateLimitStatement("confirm", options.rateLimit),
      // Matches on the token column. `db.get` binds null on a miss and never
      // throws, so the guard below is what turns a bad token into a 400.
      s.db.get({
        table: tokenTable,
        fieldName: "token",
        fieldValue: inp("token"),
        as: "reset",
      }),
      s.precondition({
        // `{ safe: true }` because this IS the existence guard: nothing earlier
        // proved the base non-null, and a bare nested drill on a null base
        // raises "Unable to locate var" as an HTTP 500.
        expr: expr(ref("reset", { safe: true }), "!=", c.null()),
        error: c.text(REJECTION),
        error_type: "badrequest",
      }),
      s.precondition({
        // Single use. Without this, a token that reached an attacker - a shared
        // mailbox, a forwarded message, a proxy log - keeps working after the
        // owner has already used it.
        expr: expr(ref("reset.used_at"), "=", c.null()),
        error: c.text(REJECTION),
        error_type: "badrequest",
      }),
      s.precondition({
        expr: expr(ref("reset.expires_at"), ">", c.now()),
        error: c.text(REJECTION),
        error_type: "badrequest",
      }),
      // Spend the token BEFORE writing the password. If the write fails, the
      // token is gone and the user requests another; the other order leaves a
      // usable token behind after a successful reset.
      s.db.edit({
        table: tokenTable,
        fieldName: "id",
        fieldValue: ref("reset.id"),
        row: { used_at: c.now() },
        as: "spent",
      }),
      // The `f.password()` column hashes on write, so the plaintext is hashed
      // here and is never stored.
      s.db.edit({
        table: options.authTable,
        fieldName: "id",
        fieldValue: ref("reset.owner"),
        row: { [options.passwordColumn]: inp("password") },
        as: "user",
      }),
      // Every other outstanding link for this account dies with the reset. A
      // password change is the standard response to "someone else may have my
      // reset email", so leaving that email's token live would defeat it.
      s.db.query({
        table: tokenTable,
        where: [expr(col("owner"), "=", ref("reset.owner")), expr(col("used_at"), "=", c.null())],
        as: "outstanding",
      }),
      s.foreach({
        list: ref("outstanding"),
        as: "stale",
        body: [
          s.db.edit({
            table: tokenTable,
            fieldName: "id",
            fieldValue: ref("stale.id"),
            row: { used_at: c.now() },
            as: "stale_spent",
          }),
        ],
      }),
    ],
    // No row, and no token. The caller now logs in the ordinary way.
    response: { ok: c.bool(true) },
  });
