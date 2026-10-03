/**
 * The single definition of how the golden bundle is built AND serialized.
 *
 * `test/bundle.test.ts` asserts it; `scripts/regen-golden.ts` writes it. Both
 * import from here, so the asserted fixture and the written one cannot drift -
 * a fixture regenerated a different way than it is asserted would silently
 * weaken the byte-exact contract this file exists to keep.
 *
 * EVERY option is set, and set to a NON-DEFAULT value. A tripwire only guards
 * what it encodes, so a golden config that leaves half the options at their
 * defaults is a tripwire that misses every default it never wrote down.
 * `GOLDEN_COVERAGE` states what "every feature" means, and `bundle.test.ts`
 * asserts the config still hits all of it - so the config cannot quietly narrow
 * while staying green.
 */
import { Xano, table, f } from "@xano/sdk";
import { createPasswordReset } from "../src/index.js";

/** Fixed, so the derived identities - and so the bundle - are deterministic. */
export const GOLDEN_WORKSPACE_NAME = "xts-password-reset-golden";

export const GOLDEN_FIXTURE_URL = new URL("./fixtures/golden-bundle.json", import.meta.url);

/** The auth table the golden workspace supplies. Declared here, not imported from helpers,
 *  so the fixture never moves because a test fixture was edited. */
const goldenAuthTable = table({
  name: "golden_user",
  auth: true,
  useXdo: false,
  schema: { email: f.email({ required: true }), password: f.password({ required: true }) },
  index: [{ type: "unique", fields: [{ name: "email" }] }],
});

/**
 * What the golden config must exercise. Asserted in `bundle.test.ts`.
 *
 * Add a feature to the module, add it here, and the assertion fails until the
 * config covers it - which is the only way a coverage claim stays true.
 */
export const GOLDEN_COVERAGE = {
  tables: ["password_reset_token"],
  queries: [
    "POST password_reset/request",
    "POST password_reset/confirm",
    "POST password_reset/validate",
  ],
  /**
   * Every option, each pinned to its NON-default value, so the fixture freezes
   * the branch a default-only config would never reach.
   *
   * The two branches a single bundle cannot hold at once - `emailProvider:
   * "xano"` (which emits no `api_key`) and `rateLimit: false` (which emits the
   * limiter disabled) - are asserted at encode level in `queries.test.ts`
   * instead. Encoding them here would mean shipping a golden with the LESS safe
   * configuration frozen into it.
   */
  options: [
    "canonical",
    "history",
    "resetUrl",
    "fromEmail",
    "emailProvider",
    "apiKeyEnv",
    "emailSubject",
    "emailIntro",
    "emailOutro",
    "emailFormat",
    "emailButtonLabel",
    "brandName",
    "brandColor",
    "tokenTtlSeconds",
    "rateLimit",
    "emailColumn",
    "passwordColumn",
  ],
} as const;

/**
 * Every option this package accepts, each at a NON-default value.
 *
 * Kept as a named object so `bundle.test.ts` can assert that its key set equals
 * `GOLDEN_COVERAGE.options` - which is what makes the coverage claim a fact
 * rather than a comment.
 */
export const GOLDEN_OPTIONS = {
  canonical: "password_reset",
  history: true,
  // A URL that ALREADY carries a query string, so the fixture freezes the
  // `&token=` join rather than the `?token=` one. The other join is asserted
  // in queries.test.ts.
  resetUrl: "https://golden.example.com/reset?lang=en",
  fromEmail: "Golden <no-reply@golden.example.com>",
  emailProvider: "resend",
  apiKeyEnv: "GOLDEN_RESEND_KEY",
  emailSubject: "Choose a new password",
  emailIntro: "Golden intro.",
  emailOutro: "Golden outro.",
  // Every one of these lands in the HTML document, and the brand name carries
  // characters that MUST be escaped - so the fixture freezes the escaping too.
  emailFormat: "html",
  emailButtonLabel: "Pick a new one",
  brandName: "Golden & Co <Ltd>",
  brandColor: "#7c3aed",
  tokenTtlSeconds: 900,
  rateLimit: { max: 3, ttl: 60 },
  emailColumn: "email",
  passwordColumn: "password",
} as const;

/** A fresh, fully-registered export. `Xano.export()` is deterministic. */
export const buildGoldenBundle = () => {
  const xano = new Xano().registerWorkspace({ name: GOLDEN_WORKSPACE_NAME });
  const defs = createPasswordReset({ authTable: goldenAuthTable, ...GOLDEN_OPTIONS });
  xano
    .registerTables([goldenAuthTable, defs.tokenTable])
    .registerApiGroups([defs.group])
    .registerQueries([defs.requestQuery, defs.confirmQuery, defs.validateQuery]);
  return xano.export();
};

/** 2-space JSON with a trailing newline - the committed fixture's on-disk form. */
export const serializeGoldenBundle = (bundle: unknown): string => JSON.stringify(bundle, null, 2) + "\n";
