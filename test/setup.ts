/**
 * Global test hygiene.
 *
 * The SDK's lock overrides are process-wide, so a test that sets one changes
 * every later test's derived guids. Vitest isolates per FILE, which hides a
 * leak between files but not within one - and a suite whose order is
 * load-bearing fails the day someone adds a case in the middle.
 *
 * A factory module has nothing else to reset: two `createPasswordReset()` calls
 * produce two fully independent def sets, which is half the reason for the
 * shape.
 */
import { afterEach } from "vitest";
import { resetLockOverrides } from "@xano/sdk";

afterEach(() => {
  resetLockOverrides();
});
