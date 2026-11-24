// `npm run test:live`: deploy test/live/index.ts to a local Xano engine, then run a whole reset over real HTTP.
// It runs twice. With the built-in mailer, which sends nothing on a local engine, so the fixture's `live/token`
// endpoint reads the token the email would carry. Then with a custom `sendEmail` posting to a capture server
// here, where the token comes out of the link in the email itself. Delivery by a real provider is not covered. Runs from .live/, a throwaway project, so the CLI's engine pin and lock
// never touch this package's package.json. Exits non-zero when a check fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, ".live");
const entry = resolve(root, "test/live/index.ts");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name: "live-fixture", private: true }) + "\n");
const bin = resolve(root, "node_modules/.bin/xanosdk");
/** What the fixture's `sendEmail` posts. */
interface Mail {
  from: string;
  to: { email: string }[];
  subject: string;
  body: { html: string; text: string };
  resetLink: string;
}
/** What the capture server received, in order. */
const mails: { key: unknown; body: Mail }[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    mails.push({ key: req.headers["x-mail-key"], body: JSON.parse(raw) as Mail });
    // A provider's rejection. The caller must not be able to tell.
    res.writeHead(422, { "content-type": "application/json" }).end('{"error":"rejected"}');
  });
});
await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
const mailUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/send`;
const mailKey = "live-mail-key";

let base = "";
/** Build and deploy the fixture, with the custom sender when a mail URL is given. */
const deploy = (customSender: boolean) => {
  const { LIVE_MAIL_URL: _, ...inherited } = process.env;
  const opts = { cwd: dir, env: { ...inherited, ...(customSender ? { LIVE_MAIL_URL: mailUrl } : {}) } };
  execFileSync(bin, ["export", entry, "--out", resolve(dir, "bundle.json"), "--no-lock"], { ...opts, stdio: "inherit" });
  const out = execFileSync(bin, ["deploy", entry, "--no-lock", "--yes", "--json", "--env-var", `LIVE_MAIL_KEY=${mailKey}`], {
    ...opts,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  base = (JSON.parse(out.slice(out.indexOf("{"))) as { url: string }).url.replace(/\/+$/, "");
};

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const reset = (path: string, body: unknown) => post(`/api:password_reset/password_reset/${path}`, body);
const live = (path: string, body: unknown) => post(`/api:live/live/${path}`, body);

const results: { name: string; ok: boolean; detail?: string }[] = [];
const record = (name: string, ok: boolean, detail?: unknown) => results.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });

/** The token the request minted. The request answers first and mints after, so this waits for the row. */
async function mintedToken(email: string): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    const found = await live("token", { email });
    if (typeof found.body?.token === "string" && found.body.token) return found.body.token;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

/** The token out of the link in the captured email. The send is the last thing a request does, so this waits for it. */
async function mailedToken(email: string): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    const mail = mails.find((m) => m.body.to[0]?.email === email);
    if (mail) return /^https:\/\/app\.example\.com\/reset\?token=([0-9a-f-]{36})$/.exec(mail.body.resetLink)?.[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

for (const customSender of [false, true]) {
  const check = (name: string, ok: boolean, detail?: unknown) =>
    record(`${customSender ? "sendEmail" : "built-in"}: ${name}`, ok, detail);
  deploy(customSender);

  const run = Date.now().toString(36);
  const email = `ada-${run}@example.com`;
  const oldPassword = "Old-horse-9";
  const newPassword = "New-horse-9";
  await live("user", { email, password: oldPassword });

  const known = await reset("request", { email });
  const unknown = await reset("request", { email: `nobody-${run}@example.com` });
  check("a request for a known address succeeds", known.status === 200, known);
  check("an unknown address gets the same answer as a known one", unknown.status === known.status && JSON.stringify(unknown.body) === JSON.stringify(known.body), { known, unknown });

  const token = customSender ? await mailedToken(email) : await mintedToken(email);
  check("the request mints a token", typeof token === "string", token);

  const validated = await reset("validate", { token });
  check("a fresh token validates", validated.status === 200 && validated.body?.ok === true, validated);
  const invented = await reset("confirm", { token: "00000000-0000-4000-8000-000000000000", password: newPassword });
  check("an invented token is refused", invented.status === 400, invented);

  const confirmed = await reset("confirm", { token, password: newPassword });
  check("a valid token sets the new password", confirmed.status === 200 && confirmed.body?.ok === true, confirmed);
  const fresh = await live("login", { email, password: newPassword });
  check("the new password works", fresh.body?.match === true, fresh);
  const stale = await live("login", { email, password: oldPassword });
  check("the old password stops working", stale.body?.match === false, stale);
  const replay = await reset("confirm", { token, password: "Third-horse-9" });
  check("a used token is refused", replay.status === 400, replay);

  if (customSender) {
    const mail = mails[0];
    const link = `https://app.example.com/reset?token=${token}`;
    check("one email goes out, and none for an unknown address", mails.length === 1, mails.length);
    check("the key is read from the workspace environment", mail?.key === mailKey, mail?.key);
    check("the sender and subject arrive as authored", mail?.body.from === "Live <live@example.com>" && mail?.body.subject === 'Reset "your" password', mail?.body);
    check("the HTML carries the whole link three times", mail?.body.body.html.split(link).length === 4, mail?.body.body.html);
    check("the text carries the whole link", mail !== undefined && mail.body.body.text.includes(link) && !mail.body.body.text.includes("<"), mail?.body.body.text);
    check("a rejected send changes nothing the caller sees", known.status === 200 && JSON.stringify(known.body) === '{"ok":true}', known);
  }
}
server.close();

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
