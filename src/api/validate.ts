/**
 * POST `password_reset/validate` - is this token still usable?
 *
 * Read-only, and it does NOT spend the token. It exists so the reset page can
 * say "this link has expired" when it loads, instead of after the user has
 * typed a new password twice.
 *
 * POST rather than GET on purpose: a GET puts the token in the URL, and a URL
 * travels into access logs, proxies and the `Referer` header of every asset the
 * page then loads.
 */
import { query, s, c, ref, inp, expr, input, type ApiGroupDef, type TableDef } from "@xano/sdk";
import type { ResolvedPasswordResetOptions } from "../options.js";
import { rateLimitStatement } from "./rate-limit.js";

/** The same sentence the confirm endpoint uses, for the same reason. */
const REJECTION = "This reset link is not valid. Request a new one.";

export const createValidateResetQuery = (
  group: ApiGroupDef,
  tokenTable: TableDef,
  options: ResolvedPasswordResetOptions,
) =>
  query({
    name: "password_reset/validate",
    verb: "POST",
    apiGroup: group,
    description: "Check whether a reset token is still usable, without spending it.",
    input: { token: input.text({ required: true }) },
    stack: [
      rateLimitStatement("validate", options.rateLimit),
      s.db.get({
        table: tokenTable,
        fieldName: "token",
        fieldValue: inp("token"),
        // Deliberately no `output` naming `token`: the column is `internal`, so
        // leaving it out is what keeps the secret out of this row entirely.
        as: "reset",
      }),
      s.precondition({
        expr: expr(ref("reset", { safe: true }), "!=", c.null()),
        error: c.text(REJECTION),
        error_type: "badrequest",
      }),
      s.precondition({
        expr: expr(ref("reset.used_at"), "=", c.null()),
        error: c.text(REJECTION),
        error_type: "badrequest",
      }),
      s.precondition({
        expr: expr(ref("reset.expires_at"), ">", c.now()),
        error: c.text(REJECTION),
        error_type: "badrequest",
      }),
    ],
    // `expires_at` so the page can show a countdown. No owner, no email, no
    // token: a valid token must not become a way to read whose account it is.
    response: { ok: c.bool(true), expires_at: ref("reset.expires_at") },
  });
