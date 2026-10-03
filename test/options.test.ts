/**
 * Every rejection in `resolveOptions`, asserted BY ITS MESSAGE.
 *
 * The message is the contract. A validation that rejects the right value with
 * the wrong sentence is a validation the consumer cannot act on - they get a
 * throw with no way to know which option was wrong.
 */
import { describe, it, expect } from "vitest";
import { table, f, env } from "@xano/sdk";
import { DEFAULT_RATE_LIMIT, resolveOptions } from "../src/options.js";
import { baseOptions, renamedColumnAuthTable, testAuthTable } from "./helpers.js";

const base = baseOptions;

describe("resolveOptions - the required options", () => {
  it("requires authTable, and says why a bare name will not do", () => {
    expect(() => resolveOptions({} as never)).toThrow(/authTable/);
  });

  it("requires a resetUrl, because there is nothing to link to without one", () => {
    expect(() => resolveOptions({ authTable: testAuthTable } as never)).toThrow(/resetUrl/);
  });

  it("rejects a relative resetUrl", () => {
    expect(() => resolveOptions({ ...base, resetUrl: "/reset" })).toThrow(/absolute URL/);
  });

  it("rejects a resetUrl whose scheme is not http(s)", () => {
    // The link goes into an email a stranger can cause to be sent. A
    // javascript: or data: URL there is a phishing primitive, not a destination.
    expect(() => resolveOptions({ ...base, resetUrl: "javascript:alert(1)" })).toThrow(/scheme/);
    expect(() => resolveOptions({ ...base, resetUrl: "data:text/html,x" })).toThrow(/scheme/);
  });

  it("accepts http and https", () => {
    expect(resolveOptions({ ...base, resetUrl: "http://localhost:5173/reset" }).resetUrl).toBe(
      "http://localhost:5173/reset",
    );
  });

  it("accepts a Value, so the URL can be resolved at request time", () => {
    // `env("APP_URL")` is the point of it: a deploy can set the variable AFTER
    // it knows its own static host, which a build-time string can never do.
    const value = env("APP_URL");
    expect(resolveOptions({ ...base, resetUrl: value }).resetUrl).toBe(value);
  });

  it("does NOT scheme-check a Value — and the option says so", () => {
    // Nothing here can read what the variable will hold. The check that exists
    // for a string is absent for a Value, which is a documented trade, not an
    // oversight: whoever can write that variable can write the link.
    expect(() => resolveOptions({ ...base, resetUrl: env("APP_URL") })).not.toThrow();
  });

  it("rejects an object that is not a Value at all", () => {
    // `{}` and `[]` reach the same branch and would encode a mail with no link
    // in it - the failure this module exists to not have.
    expect(() => resolveOptions({ ...base, resetUrl: {} as never })).toThrow(/resetUrl/);
    expect(() => resolveOptions({ ...base, resetUrl: { tag: "setting" } as never })).toThrow(
      /does not look like/,
    );
  });
});

describe("resolveOptions - the mailer", () => {
  it("defaults to Resend", () => {
    expect(resolveOptions({ ...base }).emailProvider).toBe("resend");
    expect(resolveOptions({ ...base }).apiKeyEnv).toBe("RESEND_API_KEY");
  });

  it("requires a fromEmail for Resend, and says when the failure would otherwise surface", () => {
    // Resend refuses a sender on an unverified domain, and that failure lands
    // at send time - on a real user's password reset, long after deploy.
    expect(() => resolveOptions({ ...base, fromEmail: undefined })).toThrow(/fromEmail/);
  });

  it("does not require a fromEmail for the built-in Xano mailer", () => {
    const resolved = resolveOptions({ ...base, fromEmail: undefined, emailProvider: "xano" });
    expect(resolved.fromEmail).toBeUndefined();
  });

  it("rejects a fromEmail that is not an address", () => {
    expect(() => resolveOptions({ ...base, fromEmail: "no-reply" })).toThrow(/not an address/);
  });

  it("accepts the display-name form Resend takes", () => {
    expect(resolveOptions({ ...base, fromEmail: "Acme <no-reply@acme.com>" }).fromEmail).toBe(
      "Acme <no-reply@acme.com>",
    );
  });

  it("rejects an unknown provider rather than letting it reach the engine", () => {
    expect(() => resolveOptions({ ...base, emailProvider: "sendgrid" } as never)).toThrow(/emailProvider/);
  });

  it("rejects an apiKeyEnv that is not an environment variable name", () => {
    // It is rendered into `$env.NAME` verbatim, so anything else reads as a
    // different expression at runtime.
    expect(() => resolveOptions({ ...base, apiKeyEnv: "my key" })).toThrow(/environment variable name/);
    expect(() => resolveOptions({ ...base, apiKeyEnv: "9KEY" })).toThrow(/environment variable name/);
  });

  it("names the expiry in the default email body", () => {
    expect(resolveOptions({ ...base, tokenTtlSeconds: 3600 }).emailIntro).toContain("60 minutes");
    expect(resolveOptions({ ...base, tokenTtlSeconds: 60 }).emailIntro).toContain("1 minute.");
  });
});

describe("resolveOptions - the email body", () => {
  it("defaults to the styled HTML document", () => {
    const r = resolveOptions({ ...base });
    expect(r.emailFormat).toBe("html");
    expect(r.emailButtonLabel).toBe("Choose a new password");
    expect(r.brandColor).toBe("#18181b");
    // Omitted entirely rather than blank - an empty slot reads worse than none.
    expect(r.brandName).toBeUndefined();
  });

  it("takes plain text when asked", () => {
    expect(resolveOptions({ ...base, emailFormat: "text" }).emailFormat).toBe("text");
  });

  it("rejects an unknown format", () => {
    expect(() => resolveOptions({ ...base, emailFormat: "markdown" } as never)).toThrow(/emailFormat/);
  });

  it("rejects a brandColor that is not a hex value", () => {
    // It is written into a `style` attribute, so an arbitrary string breaks the
    // document rather than restyling it.
    expect(() => resolveOptions({ ...base, brandColor: "rebeccapurple" })).toThrow(/hex colour/);
    expect(() => resolveOptions({ ...base, brandColor: "#12345" })).toThrow(/hex colour/);
    expect(() => resolveOptions({ ...base, brandColor: "#fff; background:url(x)" })).toThrow(/hex colour/);
  });

  it("accepts both hex spellings", () => {
    expect(resolveOptions({ ...base, brandColor: "#fff" }).brandColor).toBe("#fff");
    expect(resolveOptions({ ...base, brandColor: "#7C3AED" }).brandColor).toBe("#7C3AED");
  });

  it("rejects an empty brandName or button label", () => {
    expect(() => resolveOptions({ ...base, brandName: "" })).toThrow(/brandName/);
    expect(() => resolveOptions({ ...base, emailButtonLabel: "" })).toThrow(/emailButtonLabel/);
  });
});

describe("resolveOptions - the token lifetime", () => {
  it("defaults to one hour", () => {
    expect(resolveOptions({ ...base }).tokenTtlSeconds).toBe(3600);
  });

  it("refuses a lifetime outside the bounds, and says what a token is", () => {
    // A reset token is a bearer credential for one account, so an unbounded
    // lifetime is a second password sitting in an inbox forever.
    expect(() => resolveOptions({ ...base, tokenTtlSeconds: 30 })).toThrow(/tokenTtlSeconds/);
    expect(() => resolveOptions({ ...base, tokenTtlSeconds: 60 * 60 * 24 * 8 })).toThrow(/tokenTtlSeconds/);
    expect(() => resolveOptions({ ...base, tokenTtlSeconds: 90.5 })).toThrow(/whole number/);
  });
});

describe("resolveOptions - the limiter", () => {
  it("is ON by default", () => {
    // Every endpoint here is unauthenticated, one of them SENDS MAIL, and the
    // other two are the brute-force surface for a token that changes a password.
    expect(resolveOptions({ ...base }).rateLimit).toEqual(DEFAULT_RATE_LIMIT);
  });

  it("takes an explicit false as the documented opt-out", () => {
    expect(resolveOptions({ ...base, rateLimit: false }).rateLimit).toBe(false);
  });

  it("rejects a zero window rather than reading it as 'no limit'", () => {
    expect(() => resolveOptions({ ...base, rateLimit: { max: 0, ttl: 60 } })).toThrow(/at least 1/);
    expect(() => resolveOptions({ ...base, rateLimit: { max: 5, ttl: 0 } })).toThrow(/at least 1/);
  });

  it("rejects a malformed limiter", () => {
    expect(() => resolveOptions({ ...base, rateLimit: { max: "5" } } as never)).toThrow(/rateLimit/);
  });
});

describe("resolveOptions - the consumer's columns", () => {
  it("defaults to email and password", () => {
    const resolved = resolveOptions({ ...base });
    expect(resolved.emailColumn).toBe("email");
    expect(resolved.passwordColumn).toBe("password");
  });

  it("accepts columns that exist on the auth table the consumer passed", () => {
    const resolved = resolveOptions({
      ...base,
      authTable: renamedColumnAuthTable,
      emailColumn: "login_email",
      passwordColumn: "pass_hash",
    });
    expect(resolved.emailColumn).toBe("login_email");
  });

  it("names the option AND the table when a column does not exist", () => {
    // Core rejects an unknown column too, but from inside expandRow - a stack
    // trace through the encoder, naming neither this package nor the option.
    expect(() => resolveOptions({ ...base, passwordColumn: "pass_hash" })).toThrow(
      /passwordColumn.*is not a column.*test_user/s,
    );
    expect(() => resolveOptions({ ...base, emailColumn: "login_email" })).toThrow(/emailColumn/);
  });

  it("reports BOTH wrong columns in one message", () => {
    // Pointing this module at a renamed table gets both wrong far more often
    // than one. Failing on the first means the consumer fixes it, re-runs, and
    // is then told about the second - two round trips to learn one fact.
    expect(() =>
      resolveOptions({ ...base, emailColumn: "login_email", passwordColumn: "pass_hash" }),
    ).toThrow(/emailColumn.*login_email.*and.*passwordColumn.*pass_hash.*are not columns/s);
  });

  it("REFUSES a password column that is not f.password()", () => {
    // The confirm endpoint writes plaintext and relies on the COLUMN to hash on
    // write. An f.text() column would store every reset password in the clear -
    // deploying clean, answering 200, with no symptom but a readable database.
    const plain = table({
      name: "plaintext_holder",
      auth: true,
      schema: { email: f.email({ required: true }), password: f.text({ required: true }) },
    });
    expect(() => resolveOptions({ ...base, authTable: plain })).toThrow(
      /passwordColumn.*is an `f\.text\(\)` column, not `f\.password\(\)`.*in the clear/s,
    );
  });

  it("accepts an f.password column under any name", () => {
    expect(
      resolveOptions({
        ...base,
        authTable: renamedColumnAuthTable,
        emailColumn: "login_email",
        passwordColumn: "pass_hash",
      }).passwordColumn,
    ).toBe("pass_hash");
  });

  it("stays quiet when the schema is the raw ColumnDef[] escape hatch", () => {
    // A check that guesses on a shape it half-understands is worse than one
    // that stays quiet - and `skip` is not `pass`.
    const raw = table({
      name: "raw_holder",
      auth: true,
      schema: [{ name: "email", type: "email" }, { name: "password", type: "text" }] as never,
    });
    expect(() => resolveOptions({ ...base, authTable: raw })).not.toThrow();
  });

  it("accepts the system columns core injects, which no schema lists", () => {
    expect(resolveOptions({ ...base, emailColumn: "id" }).emailColumn).toBe("id");
  });

  it("rejects an empty column name", () => {
    expect(() => resolveOptions({ ...base, emailColumn: "" })).toThrow(/emailColumn/);
  });
});

describe("resolveOptions - identity and history", () => {
  it("pins no canonical of its own", () => {
    expect(resolveOptions({ ...base }).canonical).toBeUndefined();
  });

  it("rejects a canonical with characters that break the URL", () => {
    // The SDK does not validate a hand-supplied canonical, so this package does.
    expect(() => resolveOptions({ ...base, canonical: "not a slug!" })).toThrow(/A-Za-z0-9_-/);
    expect(() => resolveOptions({ ...base, canonical: "" })).toThrow(/canonical/);
  });

  it("accepts a url-safe canonical", () => {
    expect(resolveOptions({ ...base, canonical: "my_group-1" }).canonical).toBe("my_group-1");
  });

  it("keeps request history OFF by default", () => {
    // These request bodies carry a reset token and a plaintext new password.
    expect(resolveOptions({ ...base }).history).toBe(false);
  });

  it("rejects a non-boolean history rather than letting it reach the engine", () => {
    expect(() => resolveOptions({ ...base, history: "yes" } as never)).toThrow(/history/);
  });

  it("lets a consumer opt back into history explicitly", () => {
    expect(resolveOptions({ ...base, history: true }).history).toBe(true);
  });
});
