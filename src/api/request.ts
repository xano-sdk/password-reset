/**
 * POST `password_reset/request` - mail a reset link, if that address has an
 * account.
 *
 * The response is `{ ok: true }` either way, and deliberately so: an endpoint
 * that answers differently for a known and an unknown address is an account
 * enumeration oracle, and it is unauthenticated, so anyone may ask it about
 * anyone. Everything that depends on the address existing happens inside the
 * conditional; nothing about it reaches the caller.
 *
 * The constant body is not enough on its own: the response TIME would still
 * differ. A known address mints a token, writes a row and makes an outbound
 * call to the mail provider before the stack ends; an unknown one ends after
 * one lookup. So the lookup and everything after it run in `post_process`,
 * which the engine starts only after the response has gone out. The caller
 * waits for the two limiters and nothing else, whichever address it sent.
 */
import {
  query,
  s,
  c,
  ref,
  inp,
  env,
  input,
  expr,
  withFilters,
  fl,
  type ApiGroupDef,
  type TableDef,
} from "@xano/sdk";
import type { ResolvedPasswordResetOptions } from "../options.js";
import { rateLimitStatement } from "./rate-limit.js";
import { messageValue } from "./email-template.js";

export const createRequestResetQuery = (
  group: ApiGroupDef,
  tokenTable: TableDef,
  options: ResolvedPasswordResetOptions,
) =>
  query({
    name: "password_reset/request",
    verb: "POST",
    apiGroup: group,
    // No `auth`: a caller who could authenticate does not need this endpoint.
    description: "Send a password reset link to an address, if it has an account.",
    input: {
      // `methods` normalise at BIND time, so `inp("email")` is already trimmed
      // and lower-cased everywhere below - including in the rate-limit key,
      // where "A@b.com" and "a@b.com " must not buy two buckets.
      email: input.email({ required: true, methods: ["trim", "lower"] }),
    },
    // A literal tuple. Never build this array with a helper returning
    // Statement[] or a conditional spread: the tuple collapses, every ref() in
    // it resolves to unknown, and the response infers as StackTupleWidened -
    // with a byte-identical bundle and a green suite. It surfaces only in a
    // CONSUMER's typecheck.
    stack: [
      // Two buckets, because they stop different attacks. Per IP: one host
      // harvesting which addresses have accounts. Per address: one victim's
      // inbox flooded from many hosts.
      rateLimitStatement("request-ip", options.rateLimit),
      rateLimitStatement("request-email", options.rateLimit, inp("email")),
      // After the response. See the header comment: the timing of everything
      // in here depends on whether the address has an account, so none of it
      // may run while the caller is still waiting. A failure in here (a
      // misconfigured mailer, say) is equally invisible to the caller, where
      // inline it would have been a 500 only a KNOWN address could produce.
      // A plain array, like the conditional's `then`: positional `Statement[]`.
      s.util.post_process([
        s.db.get({
          table: options.authTable,
          fieldName: options.emailColumn,
          fieldValue: inp("email"),
          // Only what the mail needs. The row also holds the password hash.
          output: ["id", options.emailColumn],
          as: "user",
        }),
        s.conditional({
          // `{ safe: true }` because db.get binds null on a miss, and this is the
          // existence guard itself - there is nothing earlier to have proved the
          // base non-null.
          when: expr(ref("user", { safe: true }), "!=", c.null()),
          // A plain array. The widening rule is about the QUERY's own stack,
          // which must stay a literal tuple; a nested block is typed
          // `Statement[]` by the engine's own shape and has no tuple to lose.
          then: [
            // A v4 UUID: 122 bits of entropy, engine-generated. Never derived
            // from the address or the clock - a token a caller can predict is a
            // token a caller can mint. Not `create_guid`: it is an internal
            // statement XanoScript cannot spell, and the SDK does not expose it.
            s.security.create_uuid({ as: "token" }),
            s.db.add({
              table: tokenTable,
              row: {
                owner: ref("user.id"),
                token: ref("token"),
                // Epoch-ms, so the expiry check is one integer comparison
                // against c.now() with no timezone in the picture.
                expires_at: withFilters(c.now(), fl.add(options.tokenTtlSeconds * 1000)),
              },
              as: "reset",
            }),
            s.util.send_email({
              // Read back from the row, never echoed from the input: this is the
              // address the account actually has.
              to: ref(`user.${options.emailColumn}`),
              ...(options.fromEmail === undefined ? {} : { from: c.text(options.fromEmail) }),
              subject: c.text(options.emailSubject),
              // A JS template literal CANNOT compose a tagged value - it
              // stringifies it at build time and mails "[object Object]". The
              // document's literal halves are assembled at build time in
              // email-template.ts; the token is joined at RUNTIME, by the filter
              // chain, once per place it appears.
              message: messageValue(options, "token"),
              service_provider: options.emailProvider,
              // The key is read server-side out of the workspace environment. It
              // is never in the bundle, so it cannot reach a frontend build.
              ...(options.emailProvider === "resend" ? { api_key: env(options.apiKeyEnv) } : {}),
              as: "sent",
            }),
          ],
        }),
      ]),
    ],
    // Constant, and the whole point. See the header comment.
    response: { ok: c.bool(true) },
  });
