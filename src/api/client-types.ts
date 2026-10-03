/**
 * The per-endpoint request and response types a consumer's frontend imports.
 *
 * Purely type-level: `ReturnType<typeof …>` names the def a factory WOULD
 * build without building one, so importing these pulls no runtime and no def
 * stack into a browser bundle.
 */
import type { InferInput, InferResponse } from "@xano/sdk";
import type { createRequestResetQuery } from "./request.js";
import type { createConfirmResetQuery } from "./confirm.js";
import type { createValidateResetQuery } from "./validate.js";

/** POST `password_reset/request` request body. */
export type RequestResetBody = InferInput<ReturnType<typeof createRequestResetQuery>>;

/** POST `password_reset/request` response - `{ ok: true }`, for a known address and an unknown one alike. */
export type RequestResetResponse = InferResponse<ReturnType<typeof createRequestResetQuery>>;

/** POST `password_reset/confirm` request body. */
export type ConfirmResetBody = InferInput<ReturnType<typeof createConfirmResetQuery>>;

/** POST `password_reset/confirm` response. */
export type ConfirmResetResponse = InferResponse<ReturnType<typeof createConfirmResetQuery>>;

/** POST `password_reset/validate` request body. */
export type ValidateResetBody = InferInput<ReturnType<typeof createValidateResetQuery>>;

/** POST `password_reset/validate` response. */
export type ValidateResetResponse = InferResponse<ReturnType<typeof createValidateResetQuery>>;
