/**
 * The module's API group, minted per {@link createPasswordReset} call.
 *
 * `canonical` is the public URL token. It is left to the consumer: pinning one
 * here would put this module's choice in every consumer's URLs, and the
 * consumer's `xano.lock` is what owns identity.
 */
import { apiGroup } from "@xano/sdk";
import type { ResolvedPasswordResetOptions } from "../options.js";

export const createPasswordResetGroup = (options: ResolvedPasswordResetOptions) =>
  apiGroup({
    name: "Password Reset",
    description: "Endpoints registered by @xano-sdk/password-reset.",
    ...(options.canonical === undefined ? {} : { canonical: options.canonical }),
    // Off by default. See the reason in src/options.ts - these request bodies
    // carry a reset token and a plaintext password.
    history: options.history,
  });
