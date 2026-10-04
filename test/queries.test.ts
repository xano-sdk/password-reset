/**
 * Encode-level fidelity for the endpoints: stack order, auth binding, group
 * binding, and every guid a statement names resolving to a real object.
 *
 * A dangling guid deploys clean and fails on the first real request, so the
 * resolution assertion is not paranoia - it is the only pre-deploy check there
 * is for it.
 */
import { describe, it, expect } from "vitest";
import { env } from "@xano/sdk";
import { exportWithModule, queryIn, renamedColumnAuthTable, statementsNamed, tableIn } from "./helpers.js";

/** The engine names for the statements these stacks are built from. */
const RATELIMIT = "mvp:redis_ratelimit";
const SEND_EMAIL = "mvp:send_email";
const GET = "mvp:dbo_getby";
const ADD = "mvp:dbo_add";
const EDIT = "mvp:dbo_editby";
const CONDITIONAL = "mvp:conditional";
const POST_PROCESS = "mvp:post_process";
const PRECONDITION = "mvp:precondition";

/** One named input off an encoded statement. */
const argOf = (stmt: any, name: string): any => (stmt.input ?? []).find((i: any) => i.name === name);

describe("the API group", () => {
  it("registers all three endpoints under one group", () => {
    const bundle = exportWithModule();
    expect(bundle.payload.app).toHaveLength(1);
    expect(bundle.payload.query).toHaveLength(3);
    const groupGuid = bundle.payload.app[0].guid;
    for (const q of bundle.payload.query) expect(q.app.id).toBe(groupGuid);
  });

  it("pins the API group canonical the consumer passed", () => {
    // Without a canonical the engine mints one server-side and getPath() cannot
    // resolve in a browser bundle until a lock file exists.
    expect(exportWithModule().payload.app[0].canonical).toBe("password_reset");
  });

  it("turns request history OFF by default, by NAMING the encoded fields", () => {
    // `history` encodes as an OBJECT, so toBeFalsy() would pass on every
    // configuration and guard nothing. These bodies carry a reset token and a
    // plaintext password, which is exactly what history would store.
    expect(exportWithModule().payload.app[0].history).toMatchObject({
      inherit: false,
      query_enabled: false,
    });
  });

  it("leaves every endpoint public", () => {
    // Not an oversight: a caller who could authenticate does not need any of
    // these. `auth: false` is the encoded form of "no auth table bound".
    for (const q of exportWithModule().payload.query) expect(q.auth).toBe(false);
  });
});

describe("POST password_reset/request", () => {
  const request = (overrides = {}) => queryIn(exportWithModule(overrides), "POST", "password_reset/request");
  /** The statements that run after the response - everything address-dependent. */
  const afterResponse = (q: any): any[] => statementsNamed(q, POST_PROCESS)[0].context.run;
  /** The conditional's `then`: what runs only for an address with an account. */
  const ifUser = (q: any): any[] => afterResponse(q).find((stmt) => stmt.name === CONDITIONAL).context.if.run;

  it("answers identically whether or not the address has an account", () => {
    // The only response is a constant. An endpoint that answered differently
    // for a known and an unknown address is an account enumeration oracle, and
    // it is unauthenticated, so anyone may ask it about anyone.
    expect(request().result).toEqual([
      { filters: [], name: "ok", tag: "const:bool", value: "true", _xsid: "", disabled: false },
    ]);
  });

  it("does everything address-dependent after the response, inside the conditional", () => {
    const stack = request().run;
    // Before the response: the two limiters and NOTHING else. The lookup, the
    // token, the row and the outbound send all take time that depends on
    // whether the address has an account, so inline they would make the
    // response's timing an enumeration oracle even with a constant body.
    expect(stack.map((s: any) => s.name)).toEqual([RATELIMIT, RATELIMIT, POST_PROCESS]);
    expect(afterResponse(request()).map((s: any) => s.name)).toEqual([GET, CONDITIONAL]);
    expect(ifUser(request()).map((s: any) => s.name)).toEqual(["mvp:uuid4", ADD, SEND_EMAIL]);
  });

  it("rate-limits on the caller IP AND the target address, in separate buckets", () => {
    const limiters = statementsNamed(request(), RATELIMIT);
    expect(limiters).toHaveLength(2);
    const keys = limiters.map((l) => argOf(l, "key").value);
    // Distinct prefixes: co-attaching one key to N endpoints means all N share
    // ONE counter, so `max` would be a budget across them rather than each.
    expect(new Set(keys).size).toBe(2);
    // Per IP stops one host harvesting which addresses have accounts; per
    // address stops one victim's inbox being flooded from many hosts.
    expect(argOf(limiters[0], "key").filters[0].arg[0]).toMatchObject({ value: "$remote_ip", tag: "setting" });
    expect(argOf(limiters[1], "key").filters[0].arg[0]).toMatchObject({ value: "email", tag: "input" });
  });

  it("keys the limiter on the request context, never on auth('id')", () => {
    // auth("id") is null on a public endpoint, so an auth-keyed limiter gives
    // every caller on the internet ONE shared bucket.
    for (const limiter of statementsNamed(request(), RATELIMIT)) {
      expect(JSON.stringify(argOf(limiter, "key"))).not.toContain('"auth"');
    }
  });

  it("keeps the limiter step present but DISABLED when a consumer opts out", () => {
    const limiters = statementsNamed(request({ rateLimit: false }), RATELIMIT);
    expect(limiters).toHaveLength(2);
    // Present-and-off rather than absent: the stack stays one literal tuple in
    // both configurations, and someone reading the deployed endpoint can see
    // the limiter exists and was opted out of.
    for (const limiter of limiters) expect(limiter.disabled).toBe(true);
  });

  it("reads only the columns the mail needs off the user row", () => {
    const get = afterResponse(request()).find((stmt) => stmt.name === GET);
    // The auth row also holds the password hash.
    expect(get.output.items.map((i: any) => i.name)).toEqual(["id", "email"]);
    expect(get.output.customize).toBe(true);
  });

  it("follows the consumer's column names", () => {
    const get = afterResponse(
      request({ authTable: renamedColumnAuthTable, emailColumn: "login_email", passwordColumn: "pass_hash" }),
    ).find((stmt) => stmt.name === GET);
    expect(argOf(get, "field_name").value).toBe("login_email");
    expect(get.output.items.map((i: any) => i.name)).toEqual(["id", "login_email"]);
  });

  it("mints the token with the engine's UUIDv4 generator, not from the address or the clock", () => {
    const inner = ifUser(request());
    // A token a caller can predict is a token a caller can mint.
    expect(inner[0]).toMatchObject({ name: "mvp:uuid4", as: "token" });
    expect(argOf(inner[1], "token")).toMatchObject({ value: "token", tag: "var" });
  });

  it("computes the expiry as now + ttl in epoch-ms", () => {
    const add = ifUser(request({ tokenTtlSeconds: 1800 }))[1];
    const expires = argOf(add, "expires_at");
    expect(expires).toMatchObject({ value: "now", tag: "const:epochms" });
    expect(expires.filters[0]).toMatchObject({ name: "add" });
    expect(expires.filters[0].arg[0].value).toBe("1800000");
  });

  it("writes with the full-column row form", () => {
    const add = ifUser(request())[1];
    // `row: {}` and the `data: [{name,value}]` array are NOT interchangeable.
    // `row` emits the engine's full-column form, which is why every column -
    // including the auto-filled `used_at` - appears here.
    expect((add.input ?? []).map((i: any) => i.name)).toEqual([
      "id",
      "created_at",
      "owner",
      "token",
      "expires_at",
      "used_at",
    ]);
  });

  it("composes the link at RUNTIME, through the filter chain", () => {
    const send = ifUser(request())[2];
    const message = argOf(send, "message");
    // A JS template literal cannot compose a tagged value - it stringifies it
    // at BUILD time and mails "[object Object]". This assertion is what catches
    // that, because the encoded literal would carry the text instead.
    expect(message.value).not.toContain("[object Object]");
    expect(message.value).toContain("https://app.example.com/reset?token=");
    // HTML is the default, and the token appears THREE times - the button
    // href, the fallback href, and that link's visible text - so the chain
    // alternates token, literal, token, literal, token, literal.
    const chain = message.filters.map((f: any) => f.arg[0]);
    expect(chain).toHaveLength(6);
    for (const i of [0, 2, 4]) expect(chain[i]).toMatchObject({ value: "token", tag: "var" });
    for (const i of [1, 3, 5]) expect(chain[i].tag).toBe("const");
  });

  it("joins the reset URL at runtime when it is a Value, alternating URL and token", () => {
    // The whole point of the Value form: the URL is read when the mail is sent,
    // so a deploy can set it after it knows its own static host. The chain must
    // alternate url, "?token=", token, literal - three times over, once per
    // place the link appears in the HTML document.
    const send = ifUser(request({ resetUrl: env("APP_URL") }))[2];
    const message = argOf(send, "message");
    const chain = message.filters.map((f: any) => f.arg[0]);
    expect(chain).toHaveLength(12);
    for (const i of [0, 4, 8]) expect(chain[i]).toMatchObject({ value: "APP_URL", tag: "setting" });
    for (const i of [1, 5, 9]) expect(chain[i]).toMatchObject({ value: "?token=", tag: "const" });
    for (const i of [2, 6, 10]) expect(chain[i]).toMatchObject({ value: "token", tag: "var" });
    // And the URL is nowhere in the literal text - if it were, the build-time
    // value would have won and the variable would never be read.
    expect(message.value).not.toContain("APP_URL");
    expect(message.value).not.toContain("https://app.example.com/reset");
  });

  it("sends ONE token join in plain-text mode", () => {
    const send = ifUser(request({ emailFormat: "text" }))[2];
    const message = argOf(send, "message");
    expect(message.value).not.toContain("<");
    expect(message.filters).toHaveLength(2);
    expect(message.filters[0].arg[0]).toMatchObject({ value: "token", tag: "var" });
  });

  it("escapes the consumer's strings into the HTML document", () => {
    const send = ifUser(request({ brandName: "Ben & Jerry's <Ltd>", emailIntro: "5 > 3 & \"quoted\"" }))[2];
    const html = argOf(send, "message").value;
    // These come from config, not a request, so this is a CORRECTNESS boundary
    // rather than an XSS one - an unescaped `&` breaks the document.
    expect(html).toContain("Ben &amp; Jerry&#39;s &lt;Ltd&gt;");
    expect(html).toContain("5 &gt; 3 &amp; &quot;quoted&quot;");
    expect(html).not.toContain("<Ltd>");
  });

  it("omits the brand block entirely when no brandName is set", () => {
    const html = argOf(ifUser(request())[2], "message").value;
    // An empty slot reads worse than no slot.
    expect(html).not.toContain("text-transform:uppercase");
  });

  it("writes the accent colour into the button and the link", () => {
    const html = argOf(
      ifUser(request({ brandColor: "#7c3aed" }))[2],
      "message",
    ).value;
    expect(html).toContain("background:#7c3aed");
  });

  it("mails the address on the ROW, not the address the caller submitted", () => {
    const send = ifUser(request())[2];
    expect(argOf(send, "to")).toMatchObject({ value: "user.email", tag: "var" });
  });

  it("reads the Resend key out of the workspace environment", () => {
    const send = ifUser(request())[2];
    expect(argOf(send, "service_provider").value).toBe("resend");
    // tag "setting" is $env.NAME - resolved server-side at request time, so the
    // key is never in the bundle and cannot reach a frontend build.
    expect(argOf(send, "api_key")).toMatchObject({ value: "RESEND_API_KEY", tag: "setting" });
  });

  it("honours a custom env var name", () => {
    const send = ifUser(request({ apiKeyEnv: "MY_RESEND" }))[2];
    expect(argOf(send, "api_key").value).toBe("MY_RESEND");
  });

  it("sends no api_key at all through the built-in Xano mailer", () => {
    const send = ifUser(request({ emailProvider: "xano", fromEmail: undefined }))[2];
    expect(argOf(send, "service_provider").value).toBe("xano");
    // The built-in mailer needs no key. Emitting an empty one would look like a
    // misconfigured Resend rather than a deliberate choice.
    expect(argOf(send, "api_key")).toBeUndefined();
    expect(argOf(send, "from")).toBeUndefined();
  });
});

describe("POST password_reset/confirm", () => {
  const confirm = (overrides = {}) => queryIn(exportWithModule(overrides), "POST", "password_reset/confirm");

  it("takes the password as plain text, so the COLUMN does the hashing", () => {
    const inputs = confirm().input;
    const password = inputs.find((i: any) => i.name === "password");
    // An `input.password` hashes at BIND time; the f.password() column then
    // sees a value already in salt.hash shape, skips its own hash-on-write, and
    // stores it verbatim - so login never matches what the user typed.
    expect(password.type).toBe("text");
    expect(password.methods.map((m: any) => `${m.name}:${m.arg.join("")}`)).toContain("min:8");
  });

  it("gives the same message for an unknown, a spent and an expired token", () => {
    const messages = statementsNamed(confirm(), PRECONDITION).map((p: any) => p.context.error.value);
    expect(messages).toHaveLength(3);
    // The differences are real, but telling a caller which one applies makes
    // the endpoint an oracle about tokens it does not hold.
    expect(new Set(messages).size).toBe(1);
    for (const p of statementsNamed(confirm(), PRECONDITION)) {
      expect(p.context.error_type).toBe("badrequest");
    }
  });

  it("guards existence, then single use, then expiry - in that order", () => {
    const exprs = statementsNamed(confirm(), PRECONDITION).map(
      (p: any) => p.context.expr.expression[0].statement,
    );
    expect(exprs[0]).toMatchObject({ op: "!=", left: { operand: "reset" }, right: { tag: "const:null" } });
    expect(exprs[1]).toMatchObject({ op: "=", left: { operand: "reset.used_at" } });
    // Epoch-ms against epoch-ms: one integer comparison, no timezone.
    expect(exprs[2]).toMatchObject({ op: ">", left: { operand: "reset.expires_at" }, right: { tag: "const:epochms" } });
  });

  it("spends the token BEFORE it writes the password", () => {
    const edits = statementsNamed(confirm(), EDIT);
    const tokenGuid = tableIn(exportWithModule(), "password_reset_token").guid;
    // The other order leaves a usable token behind after a successful reset.
    expect(edits[0].context.dbo.id).toBe(tokenGuid);
    expect(argOf(edits[0], "field_value")).toMatchObject({ value: "reset.id", tag: "var" });
  });

  it("writes the new password into the consumer's auth table, keyed by the token's owner", () => {
    const bundle = exportWithModule();
    const edit = statementsNamed(queryIn(bundle, "POST", "password_reset/confirm"), EDIT)[1];

    expect(edit.context.dbo.id).toBe(tableIn(bundle, "test_user").guid);
    // The owner comes off the token row, never off an input.
    expect(argOf(edit, "field_value")).toMatchObject({ value: "reset.owner", tag: "var" });
    expect(argOf(edit, "password")).toMatchObject({ value: "password", tag: "input" });
  });

  it("follows the consumer's password column name", () => {
    const edit = statementsNamed(
      confirm({ authTable: renamedColumnAuthTable, emailColumn: "login_email", passwordColumn: "pass_hash" }),
      EDIT,
    )[1];
    expect(argOf(edit, "pass_hash")).toMatchObject({ value: "password", tag: "input" });
  });

  it("invalidates the owner's other outstanding tokens", () => {
    const stack = confirm().run;
    const sweep = stack.find((s: any) => s.name === "mvp:dbo_view");
    const loop = stack.find((s: any) => s.name === "mvp:foreach");
    // A password change is the standard response to "someone else may have my
    // reset email". Leaving that email's token live would defeat it.
    expect(sweep).toBeDefined();
    expect(loop.context.as).toBe("stale");
    expect(loop.context.list).toMatchObject({ value: "outstanding", tag: "var" });
    expect(loop.context.run[0].name).toBe(EDIT);
  });

  it("returns no row, and above all no token", () => {
    expect(JSON.stringify(confirm().result)).not.toContain("token");
  });
});

describe("POST password_reset/validate", () => {
  const validate = () => queryIn(exportWithModule(), "POST", "password_reset/validate");

  it("is a POST, so the token never lands in a URL", () => {
    // A URL travels into access logs, proxies, and the Referer header of every
    // asset the page then loads.
    expect(validate().verb.toUpperCase()).toBe("POST");
  });

  it("does not spend the token it checks", () => {
    // It exists so the reset page can say "this link has expired" when it
    // loads, not after the user has typed a new password twice.
    expect(statementsNamed(validate(), EDIT)).toEqual([]);
    expect(statementsNamed(validate(), ADD)).toEqual([]);
  });

  it("returns the expiry and nothing that identifies the account", () => {
    const names = validate().result.map((r: any) => r.name);
    expect(names).toEqual(["ok", "expires_at"]);
    // A valid token must not become a way to read whose account it is.
    expect(JSON.stringify(validate().result)).not.toContain("owner");
  });

  it("never names the internal token column in an output list", () => {
    const get = statementsNamed(validate(), GET)[0];
    // `output` OVERRIDES column visibility - it is the only way to read an
    // internal column, so leaving it out is what keeps the secret unreadable.
    expect(get.output.items).toEqual([]);
  });
});

describe("the bundle as a whole", () => {
  it("every guid a statement names resolves to an object in the same bundle", () => {
    const bundle = exportWithModule();
    const known = new Set<string>(
      [...bundle.payload.dbo, ...bundle.payload.app, ...bundle.payload.query].map((o: any) => o.guid),
    );
    const referenced: string[] = [];
    const walk = (stack: any[]): void => {
      for (const stmt of stack ?? []) {
        if (stmt.context?.dbo?.id) referenced.push(stmt.context.dbo.id);
        walk(stmt.context?.if?.run);
        walk(stmt.context?.else?.run);
        walk(stmt.context?.run);
      }
    };
    for (const q of bundle.payload.query) {
      referenced.push(q.app.id);
      if (typeof q.auth === "string") referenced.push(q.auth);
      walk(q.run);
    }
    expect(referenced.length).toBeGreaterThan(0);
    for (const guid of referenced) expect(known).toContain(guid);
  });
});
