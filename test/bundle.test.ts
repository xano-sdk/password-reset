/**
 * The byte-stability contract: the exported bundle deep-equals the committed
 * fixture, RAW - no normalizer, signature included.
 *
 * A normalizer here would turn off the oracle. The whole value of this test is
 * that it fails on any encoding change at all, including the ones that look
 * like bookkeeping, so the peer bump that moved them can be read and understood
 * before a consumer's workspace finds out.
 *
 * Regenerating the fixture is a deliberate, reviewed act - NEVER a way to make
 * this go green.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  GOLDEN_COVERAGE,
  GOLDEN_OPTIONS,
  GOLDEN_FIXTURE_URL,
  buildGoldenBundle,
  serializeGoldenBundle,
} from "./golden.js";

const goldenText = readFileSync(GOLDEN_FIXTURE_URL, "utf8");
const golden = JSON.parse(goldenText);

describe("golden bundle", () => {
  it("deep-equals the committed fixture, signature included", () => {
    expect(buildGoldenBundle()).toEqual(golden);
  });

  it("exports deterministically across instances", () => {
    expect(JSON.stringify(buildGoldenBundle())).toBe(JSON.stringify(buildGoldenBundle()));
  });

  it("is byte-for-byte what `npm run fixture:regen` writes", () => {
    // Without this, the fixture could be committed with different formatting
    // than the script emits - and the next SDK bump would produce a whitespace
    // diff that hides the real drift underneath it.
    expect(goldenText).toBe(serializeGoldenBundle(buildGoldenBundle()));
  });

  it("covers every feature the module ships", () => {
    // A tripwire only guards what it encodes. This is the assertion that stops
    // the golden config quietly narrowing while staying green.
    const bundle = buildGoldenBundle() as any;
    const tables = bundle.payload.dbo.map((t: any) => t.name);
    for (const name of GOLDEN_COVERAGE.tables) expect(tables).toContain(name);

    const routes = bundle.payload.query.map((q: any) => `${q.verb.toUpperCase()} ${q.name}`);
    expect(routes.sort()).toEqual([...GOLDEN_COVERAGE.queries].sort());

    // Every option the package accepts is named in the coverage list, so adding
    // one without adding it to the golden config fails here rather than
    // shipping a fixture that never encodes it.
    const accepted = Object.keys(GOLDEN_OPTIONS);
    expect([...GOLDEN_COVERAGE.options].sort()).toEqual(accepted.sort());
  });

  it("freezes the NON-default branch of every option", () => {
    // The options are exercised in their non-default state, so the fixture
    // covers the branch a default-only config would never reach. `history`
    // encodes as an OBJECT, so the field is named rather than tested for truth -
    // an object is always truthy, and such an assertion guards nothing.
    const bundle = buildGoldenBundle() as any;
    expect(bundle.payload.app[0].canonical).toBe("password_reset");
    expect(bundle.payload.app[0].history).toMatchObject({ inherit: false, query_enabled: true });

    const request = bundle.payload.query.find((q: any) => q.name === "password_reset/request");
    const send = request.run
      .find((s: any) => s.name === "mvp:conditional")
      .context.if.run.find((s: any) => s.name === "mvp:send_email");
    const arg = (name: string) => send.input.find((i: any) => i.name === name);
    expect(arg("subject").value).toBe("Choose a new password");
    expect(arg("from").value).toBe("Golden <no-reply@golden.example.com>");
    expect(arg("service_provider").value).toBe("resend");
    expect(arg("api_key")).toMatchObject({ value: "GOLDEN_RESEND_KEY", tag: "setting" });
    // The whole document, as the engine will assemble it: the base literal,
    // then each filter's literal in order. Asserting against `value` alone
    // would only ever see the first part.
    const message = arg("message");
    const document = [
      message.value,
      ...message.filters.map((f: any) => (f.arg[0].tag === "var" ? "<TOKEN>" : f.arg[0].value)),
    ].join("");
    // The `&token=` join, for a reset URL that already carries a query string -
    // ampersand-escaped, because the document is HTML.
    expect(document).toContain("/reset?lang=en&amp;token=<TOKEN>");
    expect(document).toContain("Golden intro.");
    expect(document).toContain("Golden outro.");
    expect(document).toContain("Pick a new one");
    expect(document).toContain("background:#7c3aed");
    // The brand name carries characters that must be escaped.
    expect(document).toContain("Golden &amp; Co &lt;Ltd&gt;");
    expect(document).not.toContain("<Ltd>");
    // Three tokens: the button href, the fallback href, and its visible text.
    expect(document.match(/<TOKEN>/g)).toHaveLength(3);

    const limiter = request.run.find((s: any) => s.name === "mvp:redis_ratelimit");
    expect(limiter.disabled).toBe(false);
    expect(limiter.input.find((i: any) => i.name === "max").value).toBe("3");
  });

  it("pins no guid of its own", () => {
    // Identity belongs to the consumer's xano.lock. A guid pinned in the module
    // collides the moment two consumers deploy into one instance.
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/guid:\s*"/);
  });
});
