/**
 * The `sendEmail` hook, and the recipes the docs publish for it.
 *
 * The security half matters most. A custom sender is the one place a consumer
 * puts their own statements inside this module's stack, so what is asserted is
 * that it lands where nothing it does can reach the response, and that the key
 * and the token stay out of everywhere they do not belong.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { Xano, c, env, expr, fl, obj, ref, s, withFilters, workspaceConfig, type Statement } from "@xano/sdk";
import { createPasswordReset, type PasswordResetOptions, type ResetEmail } from "../src/index.js";
import { baseOptions, exportWithModule, queryIn, renamedColumnAuthTable, testAuthTable } from "./helpers.js";
import { sendAppEmail, senders, type Sender } from "./senders.js";

const send = (email: ResetEmail): Statement =>
  s.api.request({
    url: "https://mail.example.com/send",
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Key": env("MAIL_KEY") },
    params: obj({ to: email.to, subject: email.subject, body: obj({ html: email.html, text: email.text }) }),
    as: "mailed",
  });

const request = (overrides: Partial<PasswordResetOptions> = {}) =>
  queryIn(exportWithModule({ sendEmail: send, ...overrides }), "POST", "password_reset/request");
const ifUser = (q: any): any[] =>
  q.run
    .find((stmt: any) => stmt.name === "mvp:post_process")
    .context.run.find((stmt: any) => stmt.name === "mvp:conditional").context.if.run;
const argOf = (stmt: any, name: string): any => stmt.input.find((i: any) => i.name === name);
const bound = (q: any, name: string): any => ifUser(q).find((stmt) => stmt.name === "mvp:set_var" && stmt.as === name);

/** A set_var's value as the engine will assemble it, with each runtime value shown as `<name>`. */
const assembled = (stmt: any): string =>
  [
    stmt.context.value,
    ...stmt.context.filters.map((f: any) => (f.arg[0].tag === "const" ? f.arg[0].value : `<${f.arg[0].value}>`)),
  ].join("");

describe("where a custom sender runs", () => {
  it("replaces the built-in send, inside the conditional, after the response", () => {
    const q = request();
    expect(q.run.map((stmt: any) => stmt.name)).toEqual([
      "mvp:redis_ratelimit",
      "mvp:redis_ratelimit",
      "mvp:post_process",
    ]);
    expect(ifUser(q).map((stmt) => stmt.name)).toEqual([
      "mvp:uuid4",
      "mvp:dbo_add",
      "mvp:set_var",
      "mvp:set_var",
      "mvp:set_var",
      "mvp:api_request",
    ]);
    // Exactly one mailer: the built-in one is gone, not left beside it.
    expect(JSON.stringify(q)).not.toContain("send_email");
  });

  it("cannot change the response", () => {
    const builtIn = queryIn(exportWithModule(), "POST", "password_reset/request");
    expect(request().result).toEqual(builtIn.result);
  });

  it("touches no other endpoint", () => {
    const custom = exportWithModule({ sendEmail: send });
    const builtIn = exportWithModule();
    for (const name of ["password_reset/confirm", "password_reset/validate"]) {
      expect(queryIn(custom, "POST", name)).toEqual(queryIn(builtIn, "POST", name));
    }
  });

  it("is called once per build, so it is not a request-time callback", () => {
    const spy = vi.fn(send);
    createPasswordReset({ ...baseOptions, sendEmail: spy });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("runs several statements in the order they were returned", () => {
    const steps = ifUser(request({ sendEmail: (email) => [s.set_var("first", email.to), send(email)] }));
    expect(steps.slice(-2).map((stmt) => stmt.name)).toEqual(["mvp:set_var", "mvp:api_request"]);
  });
});

describe("what a custom sender is handed", () => {
  it("mails the address on the ROW, under the consumer's column name", () => {
    const seen = (overrides: Partial<PasswordResetOptions>) => {
      let email: ResetEmail | undefined;
      createPasswordReset({ ...baseOptions, ...overrides, sendEmail: (e) => ((email = e), send(e)) });
      return email!;
    };
    expect(seen({}).to).toMatchObject({ value: "user.email", tag: "var" });
    expect(
      seen({ authTable: renamedColumnAuthTable, emailColumn: "login_email", passwordColumn: "pass_hash" }).to,
    ).toMatchObject({ value: "user.login_email", tag: "var" });
  });

  it("hands every runtime part over as a bare ref, so it composes in any slot", () => {
    expect.assertions(6);
    createPasswordReset({
      ...baseOptions,
      emailSubject: "A subject of mine",
      fromEmail: "mine@example.com",
      sendEmail: (email) => {
        expect(email.html).toEqual(ref("reset_html"));
        expect(email.text).toEqual(ref("reset_text"));
        expect(email.resetLink).toEqual(ref("reset_link"));
        expect(email.token).toEqual(ref("token"));
        expect(email.subject).toEqual(c.text("A subject of mine"));
        expect(email.fromEmail).toEqual(c.text("mine@example.com"));
        return send(email);
      },
    });
  });

  it("composes the link, the HTML and the text at RUNTIME", () => {
    const q = request();
    const link = "https://app.example.com/reset?token=<token>";
    expect(assembled(bound(q, "reset_link"))).toBe(link);
    const html = assembled(bound(q, "reset_html"));
    expect(html.split(link)).toHaveLength(4);
    expect(html).toContain("<!doctype html>");
    const text = assembled(bound(q, "reset_text"));
    expect(text).toContain(link);
    expect(text).not.toContain("<!doctype");
    expect(JSON.stringify(q)).not.toContain("[object Object]");
  });

  it("joins the link with & when resetUrl already has a query string", () => {
    const q = request({ resetUrl: "https://app.example.com/reset?lang=en" });
    expect(assembled(bound(q, "reset_link"))).toBe("https://app.example.com/reset?lang=en&token=<token>");
  });

  it("takes a runtime resetUrl, filters and all, in a nested body", () => {
    // The reason the parts are bound first. A filtered value cannot sit inside
    // another filter's argument in `obj()`, so handing the chain over directly
    // would throw here and nowhere else.
    const q = request({ resetUrl: withFilters(env("APP_URL"), fl.rtrim(c.text("/"))) });
    expect(assembled(bound(q, "reset_link"))).toBe("<APP_URL>?token=<token>");
    expect(argOf(ifUser(q).at(-1), "params").value).toContain("html: $var.reset_html");
  });

  it("keeps the email options working", () => {
    const html = assembled(bound(request({ brandName: "Ben & Co", emailIntro: "Hello." }), "reset_html"));
    expect(html).toContain("Ben &amp; Co");
    expect(html).toContain("Hello.");
  });
});

describe("keys and tokens", () => {
  it("reads the key from the workspace environment, never from the bundle", () => {
    const headers = argOf(ifUser(request()).at(-1), "headers");
    expect(JSON.stringify(headers)).toContain('"value":"MAIL_KEY","tag":"setting"');
  });

  it("does not read RESEND_API_KEY at all", () => {
    // An app on another provider must not be told to declare a Resend key.
    expect(JSON.stringify(exportWithModule({ sendEmail: send }))).not.toContain("RESEND_API_KEY");
  });

  it("exports clean under --strict once its own key is declared", () => {
    const xano = new Xano().registerWorkspace(
      workspaceConfig({ name: "strict-sender", env: { MAIL_KEY: "" } }),
    );
    const defs = createPasswordReset({ ...baseOptions, canonical: "password_reset", sendEmail: send });
    xano
      .registerTables([testAuthTable, defs.tokenTable])
      .registerApiGroups([defs.group])
      .registerQueries([defs.requestQuery, defs.confirmQuery, defs.validateQuery]);
    expect(() => xano.export({ strict: true })).not.toThrow();
  });
});

describe("a sender that cannot work is refused while the workspace is built", () => {
  const build = (overrides: object) => () => createPasswordReset({ ...baseOptions, ...overrides } as PasswordResetOptions);

  it("refuses one that returns nothing", () => {
    // `(email) => { s.api.request(…) }`, the missing `return`.
    expect(build({ sendEmail: () => undefined })).toThrow(/`sendEmail` must return a statement.*needs a `return`/s);
  });

  it("refuses an async one", () => {
    expect(build({ sendEmail: async (email: ResetEmail) => send(email) })).toThrow(/cannot be async/);
  });

  it("refuses an empty list, which would deploy clean and mail no one", () => {
    expect(build({ sendEmail: () => [] })).toThrow(/no reset email would ever be sent/);
  });

  it("refuses a list holding something that is not a statement", () => {
    expect(build({ sendEmail: (email: ResetEmail) => [send(email), email.html] })).toThrow(/must return a statement/);
  });

  it("requires fromEmail only when the sender reads it", () => {
    const reads = (email: ResetEmail) => s.set_var("sender", email.fromEmail);
    expect(build({ fromEmail: undefined, sendEmail: reads })).toThrow(/reads `fromEmail`.*was not passed/s);
    expect(build({ fromEmail: undefined, sendEmail: send })).not.toThrow();
    // A spread is not a read of it.
    expect(build({ fromEmail: undefined, sendEmail: (email: ResetEmail) => send({ ...email }) })).not.toThrow();
  });

  it.each(["user", "token", "reset_link", "reset_html", "reset_text"])("refuses one that binds `%s`", (name) => {
    // The email is read from it, after this statement has run. It exports clean
    // under --strict, so nothing else would stop a reset going to the wrong address.
    expect(build({ sendEmail: (email: ResetEmail) => [s.set_var(name, c.text("x")), send(email)] })).toThrow(
      new RegExp(`\`sendEmail\` binds \`${name}\``),
    );
  });

  it("finds the binding on any statement, at any depth, and in an update", () => {
    const refuses = (step: Statement) =>
      expect(build({ sendEmail: (email: ResetEmail) => [step, send(email)] })).toThrow(/`sendEmail` binds `(user|token)`/);
    refuses(s.api.request({ url: "https://auth.example.com/token", method: "POST", as: "token" }));
    refuses(s.conditional({ when: expr(c.int(1), "=", c.int(1)), then: [s.set_var("token", c.text("x"))] }));
    refuses(s.foreach({ list: ref("list"), as: "user", body: [] }));
    refuses(s.update_var("user.email", c.text("someone@else.example")));
  });

  it("leaves every other name to the sender", () => {
    expect(
      build({ sendEmail: (email: ResetEmail) => [s.set_var("access_token", c.text("x")), send(email)] }),
    ).not.toThrow();
  });
});

describe("the published recipes", () => {
  const source = readFileSync(new URL("./senders.ts", import.meta.url), "utf8");
  const docs = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const regions = new Map(
    [...source.matchAll(/^ *\/\/ #region (\w+)\n([\s\S]*?)^ *\/\/ #endregion \1$/gm)].map((m) => [m[1]!, m[2]!]),
  );
  const exportRecipe = (name: string, sender: Sender): any => {
    const xano = new Xano().registerWorkspace({ name: "recipe" });
    const defs = createPasswordReset({ ...baseOptions, canonical: "password_reset", ...sender });
    xano
      .registerTables([testAuthTable, defs.tokenTable])
      .registerApiGroups([defs.group])
      .registerQueries([defs.requestQuery, defs.confirmQuery, defs.validateQuery]);
    if (name === "function") xano.registerFunctions([sendAppEmail]);
    return xano.export();
  };

  it("has one region per recipe", () => {
    expect([...regions.keys()].sort()).toEqual(Object.keys(senders).sort());
  });

  it.each(Object.keys(senders))("%s is in llms.txt exactly as it is typechecked here", (name) => {
    expect(docs("llms.txt")).toContain(regions.get(name));
  });

  it("repeats its README example verbatim too", () => {
    expect(docs("README.md")).toContain(regions.get("sendgrid"));
  });

  /** A recipe's own statements, encoded: what follows the three bindings. */
  const steps = (name: keyof typeof senders): any[] =>
    ifUser(queryIn(exportRecipe(name, senders[name]), "POST", "password_reset/request")).slice(5);
  const params = (name: keyof typeof senders): string => argOf(steps(name)[0], "params").value;
  /** Each header the engine will build, with a runtime value shown as `<name>`. */
  const headers = (name: keyof typeof senders): string[] => {
    const shown = (v: any): string =>
      (v.tag === "setting" ? `<${v.value}>` : v.value) +
      (v.filters ?? []).map((f: any) => (f.name === "concat" ? shown(f.arg[0]) : `|${f.name}`)).join("");
    const arg = argOf(steps(name)[0], "headers");
    return [...JSON.parse(arg.value), ...arg.filters.map((f: any) => shown(f.arg[0]))];
  };

  // Asserted ENCODED, whole. A match on the recipe's text would pass on a line
  // that was commented out, or on an address in the wrong slot.
  it("sendgrid", () => {
    expect(params("sendgrid")).toBe(
      '{ personalizations: [{ to: [{ email: $var.user.email }] }], ' +
        'from: { email: "no-reply@example.com", name: "Your App" }, subject: "Reset your password", ' +
        'content: [{ type: "text/plain", value: $var.reset_text }, { type: "text/html", value: $var.reset_html }], ' +
        "tracking_settings: { click_tracking: { enable: false, enable_text: false } } }",
    );
    expect(headers("sendgrid")).toContain("Authorization: Bearer <SENDGRID_API_KEY>");
  });

  it("postmark", () => {
    expect(params("postmark")).toBe(
      '{ From: "no-reply@example.com", To: $var.user.email, Subject: "Reset your password", ' +
        'HtmlBody: $var.reset_html, TextBody: $var.reset_text, TrackLinks: "None" }',
    );
    expect(headers("postmark")).toContain("X-Postmark-Server-Token: <POSTMARK_SERVER_TOKEN>");
  });

  it("mailgun", () => {
    const arg = argOf(steps("mailgun")[0], "params");
    // Core spells a key that is not an identifier as a path, `["o:…"]`. The wire name has no brackets.
    const key = (path: string) => path.replace(/^\["(.*)"\]$/, "$1");
    const set = Object.fromEntries(arg.filters.map((f: any) => [key(f.arg[0].value), f.arg[1].value]));
    expect({ ...JSON.parse(arg.value), ...set }).toEqual({
      "o:tracking-clicks": "no",
      from: "no-reply@example.com",
      to: "user.email",
      subject: "Reset your password",
      html: "reset_html",
      text: "reset_text",
    });
    expect(headers("mailgun")).toContain("Authorization: Basic api:<MAILGUN_API_KEY>|base64_encode");
    expect(headers("mailgun")).toContain("Content-Type: multipart/form-data");
  });

  it("brevo", () => {
    expect(params("brevo")).toBe(
      '{ sender: { email: "no-reply@example.com", name: "Your App" }, to: [{ email: $var.user.email }], ' +
        'subject: "Reset your password", htmlContent: $var.reset_html, textContent: $var.reset_text }',
    );
    expect(headers("brevo")).toContain("api-key: <BREVO_API_KEY>");
  });

  it("loops", () => {
    expect(params("loops")).toBe(
      '{ transactionalId: "your-transactional-id", email: $var.user.email, ' +
        "dataVariables: { resetLink: $var.reset_link } }",
    );
    expect(headers("loops")).toContain("Authorization: Bearer <LOOPS_API_KEY>");
  });

  it("ses", () => {
    const [mail, lambda] = steps("ses");
    expect(mail.context.value).toBe(
      '{ to: $var.user.email, from: "no-reply@example.com", subject: "Reset your password", ' +
        "html: $var.reset_html, text: $var.reset_text }",
    );
    const code = JSON.stringify(lambda);
    expect(code).toMatch(/accessKeyId: ?\$env\.AWS_ACCESS_KEY_ID/);
    expect(code).toMatch(/secretAccessKey: ?\$env\.AWS_SECRET_ACCESS_KEY/);
    expect(code).toMatch(/ToAddresses: ?\[\$var\.ses_mail\.to\]/);
  });

  it("function", () => {
    const [run] = steps("function");
    const sent = JSON.stringify(run);
    expect(run.name).toBe("mvp:function");
    expect(sent).toContain('"user.email"');
    expect(sent).toContain('"reset_html"');
  });
});
