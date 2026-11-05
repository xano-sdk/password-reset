// `npm run test:live`: deploy test/live/index.ts to a local Xano engine, then run a whole reset over real HTTP.
// The local engine sends no email, so the fixture's `live/token` endpoint reads the token the email would carry.
// Delivery itself is not covered here. Runs from .live/, a throwaway project, so the CLI's engine pin and lock
// never touch this package's package.json. Exits non-zero when a check fails.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = resolve(root, ".live");
const entry = resolve(root, "test/live/index.ts");
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name: "live-fixture", private: true }) + "\n");
const bin = resolve(root, "node_modules/.bin/xanosdk");
execFileSync(bin, ["export", entry, "--out", resolve(dir, "bundle.json"), "--no-lock"], { cwd: dir, stdio: "inherit" });
const out = execFileSync(bin, ["deploy", entry, "--no-lock", "--yes", "--json"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const deployed = JSON.parse(out.slice(out.indexOf("{"))) as { url: string };
const base = deployed.url.replace(/\/+$/, "");

const post = async (path: string, body: unknown) => {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
};
const reset = (path: string, body: unknown) => post(`/api:password_reset/password_reset/${path}`, body);
const live = (path: string, body: unknown) => post(`/api:live/live/${path}`, body);

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => results.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) });

/** The token the request minted. The request answers first and mints after, so this waits for the row. */
async function mintedToken(email: string): Promise<string | undefined> {
  for (let i = 0; i < 20; i++) {
    const found = await live("token", { email });
    if (typeof found.body?.token === "string" && found.body.token) return found.body.token;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

const run = Date.now().toString(36);
const email = `ada-${run}@example.com`;
const oldPassword = "Old-horse-9";
const newPassword = "New-horse-9";
await live("user", { email, password: oldPassword });

const known = await reset("request", { email });
const unknown = await reset("request", { email: `nobody-${run}@example.com` });
check("a request for a known address succeeds", known.status === 200, known);
check("an unknown address gets the same answer as a known one", unknown.status === known.status && JSON.stringify(unknown.body) === JSON.stringify(known.body), { known, unknown });

const token = await mintedToken(email);
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

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
