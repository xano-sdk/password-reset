/**
 * @xano-sdk/password-reset - token-based password reset for a Xano SDK workspace:
 * a single-use token table, request/validate/confirm endpoints, and the reset
 * email sent with `s.util.send_email` through Resend or Xano's built-in mailer.
 *
 * This file is the WHOLE public surface. A consumer importing a deep path is
 * importing something this package never promised to keep.
 *
 * Values and types are exported separately on purpose: the type exports erase
 * at compile time, so a frontend can `import type` them and pull no def - and
 * no def's stack - into its bundle.
 */
export { createPasswordReset, registerPasswordReset } from "./register.js";
export type { PasswordResetDefs } from "./register.js";

export { DEFAULT_RATE_LIMIT, MIN_TOKEN_TTL_SECONDS, MAX_TOKEN_TTL_SECONDS } from "./options.js";
export type {
  PasswordResetOptions,
  ResolvedPasswordResetOptions,
  EmailProvider,
  RateLimitOptions,
} from "./options.js";

export type { PasswordResetToken } from "./tables/reset-token.js";
export type {
  RequestResetBody,
  RequestResetResponse,
  ConfirmResetBody,
  ConfirmResetResponse,
  ValidateResetBody,
  ValidateResetResponse,
} from "./api/client-types.js";
