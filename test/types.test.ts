/**
 * The consumer-visible type surface - and the NEGATIVE.
 *
 * The negative is the important half. A helper returning `Statement[]` spread
 * into a stack, or a conditional spread `...(cond ? [x] : [])`, collapses the
 * stack's tuple type. Every `ref()` in that stack then resolves to `unknown`
 * and the response infers as `StackTupleWidened` - possibly NESTED, as
 * `{ user: { id: StackTupleWidened } }`, which is why the check below walks the
 * type rather than comparing it at the top level.
 *
 * This module has two live opportunities to widen a stack and would notice
 * neither on its own: `rateLimitStatement()` is a helper called from inside
 * every stack, and the limiter is optional. That is why it returns one
 * `Statement` and encodes `disabled: true` rather than being spread in or out.
 *
 * NOTHING else in this repo fails when a stack widens: the bundle stays
 * byte-identical and every other test passes. It surfaces in a CONSUMER's
 * typecheck, in another repo, days later.
 *
 * These assertions are compile-time only - `expectTypeOf` erases at runtime, so
 * a failure here is a `tsc` error, which is why `npm test` runs the typecheck
 * first.
 */
import { describe, it, expectTypeOf } from "vitest";
import type { StackTupleWidened } from "@xano/sdk";
import type {
  PasswordResetToken,
  PasswordResetOptions,
  RequestResetBody,
  RequestResetResponse,
  ConfirmResetBody,
  ConfirmResetResponse,
  ValidateResetBody,
  ValidateResetResponse,
} from "../src/index.js";

/**
 * Does `StackTupleWidened` appear ANYWHERE in this type?
 *
 * Distributes over unions and walks into arrays and objects, because the marker
 * is planted at the leaf that failed to resolve, not at the root.
 */
export type WidenedIn<T> = T extends StackTupleWidened
  ? true
  : T extends readonly (infer E)[]
    ? WidenedIn<E>
    : T extends object
      ? { [K in keyof T]-?: WidenedIn<T[K]> }[keyof T]
      : false;

export type ContainsWidened<T> = true extends WidenedIn<T> ? true : false;

describe("no endpoint's response is widened away", () => {
  it("the request response traces to a real shape", () => {
    expectTypeOf<ContainsWidened<RequestResetResponse>>().toEqualTypeOf<false>();
  });

  it("the confirm response traces to a real shape", () => {
    expectTypeOf<ContainsWidened<ConfirmResetResponse>>().toEqualTypeOf<false>();
  });

  it("the validate response traces to a real shape", () => {
    // This one derives a `ref()` out of the stack rather than a constant, so it
    // is the response that actually proves the tuple survived the helper call.
    expectTypeOf<ContainsWidened<ValidateResetResponse>>().toEqualTypeOf<false>();
    expectTypeOf<ValidateResetResponse>().toHaveProperty("expires_at");
  });
});

describe("row and request types", () => {
  it("the row carries the system columns core injects", () => {
    expectTypeOf<PasswordResetToken>().toHaveProperty("id");
    expectTypeOf<PasswordResetToken>().toHaveProperty("created_at");
    expectTypeOf<PasswordResetToken>().toHaveProperty("owner");
    expectTypeOf<PasswordResetToken>().toHaveProperty("expires_at");
    expectTypeOf<PasswordResetToken>().toHaveProperty("used_at");
  });

  it("the request body takes an address and nothing else", () => {
    expectTypeOf<RequestResetBody>().toHaveProperty("email");
    expectTypeOf<Extract<keyof RequestResetBody, "token">>().toEqualTypeOf<never>();
  });

  it("the confirm body takes the token and the new password", () => {
    expectTypeOf<ConfirmResetBody>().toHaveProperty("token");
    expectTypeOf<ConfirmResetBody>().toHaveProperty("password");
  });

  it("the confirm body does NOT carry the account it acts on", () => {
    // The owner comes off the token row. If it ever becomes an input, this
    // fails - and it should, because an owner the client can name is one it can
    // forge into a reset of somebody else's account.
    expectTypeOf<Extract<keyof ConfirmResetBody, "owner" | "email" | "user_id">>().toEqualTypeOf<never>();
  });

  it("the validate body takes only the token", () => {
    expectTypeOf<keyof ValidateResetBody>().toEqualTypeOf<"token">();
  });
});

describe("options", () => {
  it("leaves every defaulted option optional", () => {
    // An empty object is assignable to this projection only while every one of
    // them stays optional.
    expectTypeOf<Record<string, never>>().toMatchTypeOf<
      Pick<
        PasswordResetOptions,
        | "canonical"
        | "history"
        | "fromEmail"
        | "emailProvider"
        | "apiKeyEnv"
        | "emailSubject"
        | "emailIntro"
        | "emailOutro"
        | "tokenTtlSeconds"
        | "rateLimit"
        | "emailColumn"
        | "passwordColumn"
      >
    >();
  });

  it("requires the two the module cannot supply", () => {
    expectTypeOf<PasswordResetOptions>().toHaveProperty("authTable");
    expectTypeOf<PasswordResetOptions>().toHaveProperty("resetUrl");
    expectTypeOf<Record<string, never>>().not.toMatchTypeOf<PasswordResetOptions>();
  });

  it("narrows the provider to the two the engine takes", () => {
    expectTypeOf<PasswordResetOptions["emailProvider"]>().toEqualTypeOf<"resend" | "xano" | undefined>();
  });

  it("lets the limiter be turned off only with an explicit false", () => {
    expectTypeOf<false>().toMatchTypeOf<PasswordResetOptions["rateLimit"]>();
    expectTypeOf<true>().not.toMatchTypeOf<PasswordResetOptions["rateLimit"]>();
  });
});
