/**
 * Public options, and the single gate every one of them passes through.
 *
 * ALL validation lives here, and it runs BEFORE any def is built. A check
 * scattered into a def factory runs at a point where the error cannot name
 * which option was wrong - the consumer gets a stack trace through the encoder
 * instead of a sentence naming their mistake.
 */
import type { TableDef, Value } from "@xano/sdk";

/**
 * Is this a tagged `Value` - `env("APP_URL")`, `c.text(…)`, `inp(…)` - rather
 * than a plain string?
 *
 * Structural, because core does not export `isTaggedValue`. Every tagged value
 * carries a string `tag`; nothing a consumer would pass as a URL does.
 */
const isRuntimeValue = (v: unknown): v is Value =>
  typeof v === "object" && v !== null && typeof (v as { tag?: unknown }).tag === "string";

/**
 * Which mailer `s.util.send_email` hands the message to.
 *
 * ⚠ `"xano"` is **not usable for a password reset**, and the name is the only
 * thing about it that suggests otherwise. The built-in mailer sends AS the
 * workspace admin and delivers ONLY TO the workspace admin - confirmed on a live
 * instance, where messages to a non-admin reported `status: "success"`,
 * decremented the send quota, and never arrived, while the same messages to the
 * admin did. This module mails USERS, so `"xano"` will silently deliver nothing
 * for every caller who is not the admin. It is kept because the engine offers it
 * and it is fine for a smoke test from the admin's own account.
 */
export type EmailProvider = "resend" | "xano";

/** Plain text, or the styled HTML document. */
export type EmailFormat = "html" | "text";

/** How many requests one key may make in a window. `false` turns the limiter OFF. */
export interface RateLimitOptions {
  /** Requests allowed per window. */
  max: number;
  /** Window length, in seconds. */
  ttl: number;
}

/** What a consumer passes to {@link registerPasswordReset}. */
export interface PasswordResetOptions {
  /**
   * The consumer's auth table. The reset rows point at it and the confirm
   * endpoint writes the new password into it, so the module cannot supply it -
   * and this is the single fact that forces the factory shape: `f.tableRef`
   * resolves the target's guid at column-construction time, so a module-level
   * def would bake in the wrong one.
   */
  authTable: TableDef;

  /**
   * The page in YOUR frontend that collects the new password. The email links
   * to `<resetUrl>?token=<token>`, and that page posts the token back to
   * `POST password_reset/confirm`.
   *
   * Must be `http:` or `https:`. A `javascript:`/`data:` URL is refused here:
   * it lands in an email a stranger can cause to be sent, which is a phishing
   * primitive, and no validation downstream recovers from it.
   *
   * ⚠ Resolved at **export** time - it is baked into the email body as a
   * build-time constant. `xanosdk deploy --static` mints a NEW static host on
   * every run, so on an ephemeral environment this can never address the
   * frontend that is currently serving; deploy N can only carry deploy N-1's
   * URL. There is no ordering that fixes it either: a deploy WITHOUT `--static`
   * removes the static host altogether (verified - the URL that served `200`
   * answers `404`), so learning the host and redeploying the backend takes the
   * app down.
   *
   * On an ephemeral, point this at your local dev server
   * (`"http://127.0.0.1:5173/"`) and run the UI against the deployed backend.
   * Pass the real URL when the frontend lives somewhere that does not move.
   *
   * ## Resolving it at REQUEST time instead
   *
   * Pass a `Value` and the URL is read when the email is sent, not when the
   * workspace is built:
   *
   * ```ts
   * import { env } from "@xano/sdk";
   * registerPasswordReset(app, { authTable: userTable, resetUrl: env("APP_URL") });
   * ```
   *
   * Declare `APP_URL` in `workspaceConfig({ env })`, and once a `--static`
   * deploy knows its host, set it on the running backend with
   * `xanosdk env set APP_URL` - no redeploy, so the static host stays up. The
   * emailed link then addresses the frontend that is actually serving. Three
   * constraints come with it, none of them checkable here:
   *
   * - **No query string.** The `?`-vs-`&` separator depends on the URL's
   *   content, which a build-time compiler cannot read, so the runtime form
   *   always appends `?token=`. `https://app.example.com/reset` is fine;
   *   `…/reset?ref=email` would produce two `?`.
   * - **No scheme check.** The `http:`/`https:` refusal below runs on a string
   *   only. Whatever the variable holds goes into the mail, so treat write
   *   access to that variable as write access to a link your users are asked to
   *   trust.
   * - **Not HTML-escaped.** In `emailFormat: "html"` the value lands in an
   *   `href` and in the visible link text without escaping - a build-time escape
   *   cannot reach a runtime value. A `"` in the variable breaks the attribute.
   *
   * A string stays the right answer wherever the frontend URL is stable: it is
   * validated here, escaped, and emits the identical bundle it always has.
   */
  resetUrl: string | Value;

  /**
   * The `From:` address. REQUIRED for Resend, which refuses to send from a
   * domain the account has not verified, and the failure surfaces as a 4xx from
   * the provider at request time rather than at deploy.
   *
   * Optional for `emailProvider: "xano"` - the built-in mailer supplies its own
   * sender and needs no verified domain.
   */
  fromEmail?: string;

  /**
   * Which mailer sends the reset email. Default `"resend"`.
   *
   * `"xano"` is the built-in mailer: no API key, no verified sender, no
   * configuration. It is the right choice for a prototype and for a test that
   * must not depend on a third-party account.
   */
  emailProvider?: EmailProvider;

  /**
   * The workspace environment variable holding the Resend API key. Default
   * `"RESEND_API_KEY"`. Read server-side with `env()`, so the key never enters
   * the bundle or the frontend.
   *
   * Declare the name, empty, in `workspaceConfig({ env })` and keep the value
   * in `xano/.env`; `xanosdk env set <name>` changes it live. Once a config
   * declares any env var, `export()` warns on an `env()` name it does not.
   *
   * Ignored when `emailProvider` is `"xano"`.
   */
  apiKeyEnv?: string;

  /** Subject line of the reset email, and its heading. Default `"Reset your password"`. */
  emailSubject?: string;

  /**
   * `"html"` (default) sends the styled document; `"text"` sends plain text.
   *
   * There is one `message` field on the engine's statement, so this is a choice
   * rather than a multipart email: an HTML send carries no text alternative.
   */
  emailFormat?: EmailFormat;

  /** The button's label, HTML only. Default `"Choose a new password"`. */
  emailButtonLabel?: string;

  /**
   * A short product name shown above the heading, HTML only. Omitted entirely
   * when unset - an empty slot reads worse than no slot.
   */
  brandName?: string;

  /**
   * The button and link colour, as a hex value. Default `"#18181b"` (near
   * black), which sits correctly on the light and dark card alike.
   *
   * White is the button's text colour and is not configurable, so a pale accent
   * makes the label unreadable. Pick something with contrast.
   */
  brandColor?: string;

  /** The line above the reset link. Default names the expiry in minutes. */
  emailIntro?: string;

  /** The line below the reset link. Default tells a non-requester to ignore it. */
  emailOutro?: string;

  /**
   * How long a reset token stays usable, in seconds. Default `3600` (one hour).
   *
   * Bounded to 60s..7d: a token is a bearer credential for one account, so an
   * unbounded lifetime is a permanent second password sitting in an inbox.
   */
  tokenTtlSeconds?: number;

  /**
   * Rate limit on the three public endpoints, or `false` to remove it.
   * Default `{ max: 5, ttl: 900 }` - five per fifteen minutes.
   *
   * On by default and not a preference: every endpoint here is unauthenticated,
   * one of them SENDS MAIL (it costs money and it lands in someone else's
   * inbox), and the other two are the brute-force surface for a token that
   * changes a password. `false` is an explicit, documented opt-out.
   */
  rateLimit?: RateLimitOptions | false;

  /**
   * Pin the API group's public URL token.
   *
   * Left unset, the engine mints it server-side, and `getPath()` cannot resolve
   * in a browser bundle until a lock file exists. Identity otherwise belongs to
   * the consumer's `xano.lock` - this module pins no guid.
   */
  canonical?: string;

  /**
   * Capture request bodies in the workspace's request history. Default OFF.
   *
   * Not a preference here even by the usual standard: these request bodies
   * carry a reset token AND a plaintext new password, so an inheriting endpoint
   * would write both into the history store on every call.
   * `{ history: true }` opts back in.
   */
  history?: boolean;

  /** Column on `authTable` holding the address. Default `"email"`. */
  emailColumn?: string;

  /** Column on `authTable` holding the hash. Default `"password"`. */
  passwordColumn?: string;
}

/** The options with every default applied. Defs are built from THIS, never from the raw input. */
export interface ResolvedPasswordResetOptions {
  authTable: TableDef;
  /** A string (validated, escaped, folded at build time) or a runtime `Value`. */
  resetUrl: string | Value;
  fromEmail: string | undefined;
  emailProvider: EmailProvider;
  apiKeyEnv: string;
  emailSubject: string;
  emailIntro: string;
  emailOutro: string;
  emailFormat: EmailFormat;
  emailButtonLabel: string;
  brandName: string | undefined;
  brandColor: string;
  tokenTtlSeconds: number;
  rateLimit: RateLimitOptions | false;
  canonical: string | undefined;
  history: boolean;
  emailColumn: string;
  passwordColumn: string;
}

/**
 * The alphabet the engine's own `mintCanonical()` emits (url-safe base64).
 * Anything outside it lands in a URL path unescaped and produces a broken
 * endpoint - and the SDK does not validate a hand-supplied canonical, so this
 * package does.
 */
const CANONICAL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** `#rgb` or `#rrggbb`. The value lands in a `style` attribute, so it is checked rather than trusted. */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** A shell-style environment variable name. `env()` renders it into `$env.NAME` verbatim. */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Bounds on the token lifetime. See {@link PasswordResetOptions.tokenTtlSeconds}. */
export const MIN_TOKEN_TTL_SECONDS = 60;
export const MAX_TOKEN_TTL_SECONDS = 604_800;

/** The default limiter. Public, so a consumer can widen it from a known base. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { max: 5, ttl: 900 };

const DEFAULT_TOKEN_TTL_SECONDS = 3600;

/**
 * The column names on a table def, or `null` when they cannot be read.
 *
 * `table({ schema })` takes either a `FieldMap` record - the normal form - or a
 * raw `ColumnDef[]` escape hatch. Both are handled; anything else returns
 * `null`, and the caller then skips the check rather than inventing a rejection
 * for a shape it does not understand.
 */
const columnNamesOf = (authTable: TableDef): string[] | null => {
  const schema: unknown = (authTable as { schema?: unknown }).schema;
  if (Array.isArray(schema)) {
    const names = schema.map((column) => (column as { name?: unknown }).name);
    return names.every((name) => typeof name === "string") ? (names as string[]) : null;
  }
  if (schema !== null && typeof schema === "object") return Object.keys(schema as object);
  return null;
};

/**
 * The engine type of one column, or `null` when it cannot be read.
 *
 * Only the `FieldMap` form carries it in a place worth reading. A raw
 * `ColumnDef[]` schema does too, but it is the escape hatch - and a check that
 * guesses on a shape it half-understands is worse than one that stays quiet.
 */
const columnTypeOf = (authTable: TableDef, column: string): string | null => {
  const schema: unknown = (authTable as { schema?: unknown }).schema;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return null;
  const field = (schema as Record<string, unknown>)[column];
  if (field === null || typeof field !== "object") return null;
  const type = (field as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
};

const fail = (message: string): never => {
  throw new Error(`registerPasswordReset: ${message}`);
};

const requireIdentifier = (value: unknown, option: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`\`${option}\` must be a non-empty string when passed.`);
  }
  return value as string;
};

export function resolveOptions(options: PasswordResetOptions): ResolvedPasswordResetOptions {
  if (options.authTable === undefined || options.authTable === null) {
    fail(
      "`authTable` is required. Pass the def handle for your auth table - a bare table NAME " +
        "cannot be resolved to a guid, and the column would deploy dangling.",
    );
  }

  // Two accepted shapes: a build-time string, checked hard below, or a runtime
  // `Value` (`env("APP_URL")`), which cannot be checked at all - see the option's
  // docs for the three constraints that come with it.
  if (isRuntimeValue(options.resetUrl)) {
    // Nothing to validate. The one thing worth refusing is a value that is
    // obviously not one: `{}` and `[]` reach here as objects and would encode to
    // a mail with no link in it.
    if (typeof options.resetUrl.value !== "string" && typeof options.resetUrl.value !== "number") {
      fail(
        "`resetUrl` was passed a value whose `value` is not a string - it does not look like " +
          'anything `env("APP_URL")`, `c.text(…)` or `inp(…)` produces. Pass a string URL, or a ' +
          "Value that resolves to one at request time.",
      );
    }
  } else {
    if (typeof options.resetUrl !== "string" || options.resetUrl.length === 0) {
      fail(
        "`resetUrl` is required: it is the page the emailed link points at. Pass an absolute " +
          'http(s) URL, or a Value (`env("APP_URL")`) to resolve it at request time.',
      );
    }
    let parsedResetUrl: URL;
    try {
      parsedResetUrl = new URL(options.resetUrl);
    } catch {
      return fail(
        `\`resetUrl\` "${options.resetUrl}" is not an absolute URL. It goes into an email, ` +
          "so a relative path resolves against nothing.",
      );
    }
    if (parsedResetUrl.protocol !== "http:" && parsedResetUrl.protocol !== "https:") {
      fail(
        `\`resetUrl\` "${options.resetUrl}" uses the "${parsedResetUrl.protocol}" scheme. Only http ` +
          "and https are accepted - any other scheme in a link this module mails out is a " +
          "phishing primitive, not a destination.",
      );
    }
  }

  const emailProvider = options.emailProvider ?? "resend";
  if (emailProvider !== "resend" && emailProvider !== "xano") {
    fail(
      `\`emailProvider\` must be "resend" or "xano", not "${String(options.emailProvider)}". ` +
        "The engine takes these two and nothing else, and an unrecognised one deploys clean " +
        "and then fails the first send.",
    );
  }

  if (options.fromEmail !== undefined) {
    const from = requireIdentifier(options.fromEmail, "fromEmail");
    if (!from.includes("@")) {
      fail(`\`fromEmail\` "${from}" is not an address. Pass "Name <you@your-domain.com>" or "you@your-domain.com".`);
    }
  } else if (emailProvider === "resend") {
    fail(
      "`fromEmail` is required when `emailProvider` is \"resend\". Resend refuses a sender on an " +
        "unverified domain, and that failure surfaces at send time as a provider 4xx - long " +
        "after deploy, on a user's password reset.",
    );
  }

  const apiKeyEnv = options.apiKeyEnv ?? "RESEND_API_KEY";
  if (!ENV_NAME_PATTERN.test(apiKeyEnv)) {
    fail(
      `\`apiKeyEnv\` "${apiKeyEnv}" is not an environment variable name. It is rendered into ` +
        "`$env.NAME` verbatim, so anything else reads as a different expression at runtime.",
    );
  }

  const tokenTtlSeconds = options.tokenTtlSeconds ?? DEFAULT_TOKEN_TTL_SECONDS;
  if (!Number.isInteger(tokenTtlSeconds)) {
    fail("`tokenTtlSeconds` must be a whole number of seconds.");
  }
  if (tokenTtlSeconds < MIN_TOKEN_TTL_SECONDS || tokenTtlSeconds > MAX_TOKEN_TTL_SECONDS) {
    fail(
      `\`tokenTtlSeconds\` must be between ${MIN_TOKEN_TTL_SECONDS} and ${MAX_TOKEN_TTL_SECONDS} ` +
        `(got ${tokenTtlSeconds}). A reset token is a bearer credential for one account, so an ` +
        "unbounded lifetime is a second password sitting in an inbox forever.",
    );
  }

  let rateLimit: RateLimitOptions | false = DEFAULT_RATE_LIMIT;
  if (options.rateLimit !== undefined) {
    if (options.rateLimit === false) {
      rateLimit = false;
    } else if (
      typeof options.rateLimit !== "object" ||
      options.rateLimit === null ||
      !Number.isInteger(options.rateLimit.max) ||
      !Number.isInteger(options.rateLimit.ttl)
    ) {
      fail("`rateLimit` must be `{ max, ttl }` with whole-number seconds, or `false` to remove the limiter.");
    } else if (options.rateLimit.max < 1 || options.rateLimit.ttl < 1) {
      fail(
        `\`rateLimit\` needs \`max\` and \`ttl\` of at least 1 (got max=${options.rateLimit.max}, ` +
          `ttl=${options.rateLimit.ttl}). A zero window is not "no limit", it is a limiter that ` +
          "rejects every request.",
      );
    } else {
      rateLimit = { max: options.rateLimit.max, ttl: options.rateLimit.ttl };
    }
  }

  if (options.canonical !== undefined) {
    const canonical = requireIdentifier(options.canonical, "canonical");
    if (!CANONICAL_PATTERN.test(canonical)) {
      fail(
        `\`canonical\` "${canonical}" has characters outside [A-Za-z0-9_-]. It becomes a URL path ` +
          "segment, so anything else deploys a broken endpoint.",
      );
    }
  }

  if (options.history !== undefined && typeof options.history !== "boolean") {
    fail(
      "`history` must be a boolean. It decides whether request BODIES are stored - here that is " +
        "a reset token and a plaintext password - so an unrecognised value must not fall through " +
        "to the engine's inherit-on default.",
    );
  }

  const emailFormat = options.emailFormat ?? "html";
  if (emailFormat !== "html" && emailFormat !== "text") {
    fail(`\`emailFormat\` must be "html" or "text", not "${String(options.emailFormat)}".`);
  }

  const brandColor = options.brandColor ?? "#18181b";
  if (!HEX_COLOR_PATTERN.test(brandColor)) {
    fail(
      `\`brandColor\` "${brandColor}" is not a hex colour (#rgb or #rrggbb). It is written into a ` +
        "`style` attribute in the email, so an arbitrary string would break the document rather " +
        "than restyle it.",
    );
  }

  if (options.brandName !== undefined) requireIdentifier(options.brandName, "brandName");

  const emailColumn = options.emailColumn === undefined ? "email" : requireIdentifier(options.emailColumn, "emailColumn");
  const passwordColumn =
    options.passwordColumn === undefined ? "password" : requireIdentifier(options.passwordColumn, "passwordColumn");

  // Both names reach `s.db.get`/`s.db.edit` against the CONSUMER's table. Core
  // rejects an unknown column there too, but from inside `expandRow` - a stack
  // trace through the encoder, naming neither this package nor the option that
  // was wrong. Checked here, the consumer gets a sentence.
  const known = columnNamesOf(options.authTable);
  if (known !== null) {
    // `id` and `created_at` are auto-injected onto every table and are absent
    // from the authored schema, so they are legal targets that are not listed.
    const legal = [...known, "id", "created_at"];
    // BOTH are reported at once. Pointing this module at a table whose columns
    // are named differently gets both wrong far more often than one, and
    // failing on the first means the consumer fixes it, re-runs, and is told
    // about the second - which is two round trips to learn one fact.
    const wrong = ([
      ["emailColumn", emailColumn],
      ["passwordColumn", passwordColumn],
    ] as const).filter(([, column]) => !legal.includes(column));

    if (wrong.length > 0) {
      const named = wrong.map(([option, column]) => `\`${option}\` "${column}"`).join(" and ");
      fail(
        `${named} ${wrong.length > 1 ? "are not columns" : "is not a column"} of the \`authTable\` ` +
          `you passed ("${String((options.authTable as { name?: unknown }).name)}"). ` +
          `Its columns are: ${legal.join(", ")}.`,
      );
    }

    // The confirm endpoint writes the submitted password as PLAINTEXT, because
    // hashing is the COLUMN's behaviour: `f.password()` hashes on write. Point
    // this module at an `f.text()` column and every reset stores a password in
    // the clear - it deploys clean, the endpoint answers 200, and the only
    // symptom is that the database is full of readable passwords.
    //
    // Provable here, so it is refused here rather than written down as a
    // caveat. Only when the type can actually be READ: a raw ColumnDef[] schema
    // is the escape hatch, and a check that guesses is worse than one that
    // stays quiet.
    const passwordType = columnTypeOf(options.authTable, passwordColumn);
    if (passwordType !== null && passwordType !== "password") {
      fail(
        `\`passwordColumn\` "${passwordColumn}" is an \`f.${passwordType}()\` column, not \`f.password()\`. ` +
          "The confirm endpoint writes the submitted password as plaintext and relies on the COLUMN to " +
          "hash it on write, so this would store every reset password in the clear - deploying clean, " +
          "answering 200, with no symptom but a readable database.",
      );
    }

  }

  const ttlMinutes = Math.round(tokenTtlSeconds / 60);
  return {
    authTable: options.authTable,
    resetUrl: options.resetUrl,
    fromEmail: options.fromEmail,
    emailProvider,
    apiKeyEnv,
    emailSubject: options.emailSubject === undefined ? "Reset your password" : requireIdentifier(options.emailSubject, "emailSubject"),
    emailIntro:
      options.emailIntro === undefined
        ? `Use the link below to choose a new password. It stops working in ${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"}.`
        : requireIdentifier(options.emailIntro, "emailIntro"),
    emailOutro:
      options.emailOutro === undefined
        ? "If you did not ask for this, ignore this message. Your password does not change until the link is used."
        : requireIdentifier(options.emailOutro, "emailOutro"),
    emailFormat,
    emailButtonLabel:
      options.emailButtonLabel === undefined
        ? "Choose a new password"
        : requireIdentifier(options.emailButtonLabel, "emailButtonLabel"),
    brandName: options.brandName,
    brandColor,
    tokenTtlSeconds,
    rateLimit,
    canonical: options.canonical,
    history: options.history ?? false,
    emailColumn,
    passwordColumn,
  };
}
