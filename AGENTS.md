# AGENTS.md

This file is for an agent working **on this repo**. If you are an agent
**consuming** @xano-sdk/password-reset in another project, read [llms.txt](llms.txt) instead - it
describes the published API and nothing about this repo's internals.

## What this is

@xano-sdk/password-reset is a Xano SDK module: an npm package that exports plain, typed def objects and
nothing else. **There is no runtime.** `table()`, `query()`, `apiGroup()` are identity
functions; the CONSUMER's `Xano` instance does all registration and encoding at `export()`.

So everything this package can get wrong shows up in exactly two places - the encoded bundle,
and the consumer's typecheck - and both are testable here with no network.

## Commands

```bash
npm run build        # tsup -> dist/ (esm + a dts rollup)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint .
npm test             # tsc --noEmit && vitest run
npm run fixture:regen  # rewrite the golden fixture. A REVIEWED act - see below.
```

Before committing: `npm run typecheck && npm run lint && npm test`.

Changing `.github/scripts/` or `.github/RELEASE_TEMPLATE.md`: `cd .github/scripts && python3 test_slack_release_message.py`.

## Layout

- `src/index.ts` - the whole public surface. Values and types exported separately.
- `src/register.ts` - `createPasswordReset` builds; `registerPasswordReset` builds, registers, and returns the def set.
- `src/options.ts` - public option types and `resolveOptions`: the single validation gate.
- `src/tables/` - one table def factory per file.
- `src/api/` - the API group and the endpoints; `client-types.ts` is type-level only.
- `test/` - the suites. `helpers.ts` holds every shared fixture; `golden.ts` defines how the
  golden bundle is built and serialized.
- `scripts/regen-golden.ts` - writes the fixture. Typechecked with `src`, published nowhere.

## Rules that bite

Each rule carries its reason. A rule without its reason gets "simplified" away by the next
agent, and most of these fail in someone ELSE's repo rather than in this one.

- **References use def handles, never bare names.** `s.db.get({ table: itemTable })`,
  `f.tableRef(authTable)`. A bare name cannot be resolved to a guid, and the reference deploys
  dangling - clean at deploy, fatal on the first real request.
- **The defs are FACTORIES, and must stay factories.** `f.tableRef` resolves its target's guid
  EAGERLY, at column-construction time. Hoisting a def to module level bakes in whatever table
  it saw when the module was first evaluated, and it can never be re-pointed. This single fact
  is why the whole package is laid out the way it is.
- **Keep the `WeakSet<Xano>` guard.** Core's duplicate-def guard compares def IDENTITY, so two
  `createPasswordReset()` calls produce distinct objects sharing names, slip past it, and detonate
  at `export()` as "Duplicate object guid … shared by …" - naming neither call site.
- **`registerPasswordReset` returns the def set, never void.** It is the consumer's only route to
  the registered defs.
- **Pin no guid, and no canonical by default.** Identity belongs to the consumer's `xano.lock`
  (fallback `md5("<kind>:<name>")`). The only exception is the opt-in `canonical` the CONSUMER
  passes, so `getPath()` resolves in a browser with no lock file.
- **Never widen a stack.** A query's `stack` must stay a literal tuple. A helper returning
  `Statement[]` spread into it, or a conditional spread `...(cond ? [x] : [])`, collapses the
  tuple, and every `as`/`ref()` in that stack resolves to `unknown` - the response infers as
  `StackTupleWidened`. **Nothing here fails when this happens**: the bundle stays byte-identical
  and every test passes. It surfaces only in a consumer's typecheck. Use core's
  `statements(...)` for a helper and two explicit `statements(...)` branches for a conditional.
  `test/types.test.ts` asserts the negative - it is the only guard there is.
- **Prefer derivation over `responseShape`.** A declaration overrides derivation and is never
  cross-checked, so it is a hand-maintained contract that drifts from the `output` list in
  silence. Declare one only where core's static walk genuinely cannot see the value.
- **Values stay explicit `c.*`, never bare literals.** Core coerces raw literals inside call and
  agent input maps, verified byte-identical - so it buys nothing, and it costs the engine tag at
  the call site, which is load-bearing wherever a constant is a magic string the engine reads.
- **`s.db.add`/`edit`: use `row: {}`.** The `data: [{name,value}]` array is not
  interchangeable; `row` emits the engine's full-column form.
- **Security defaults are not preferences.** Request history off; ownership from the token, never
  from an input; secrets as `internal` columns. Each one carries a comment naming the failure it
  prevents, and changing one needs a stated reason - not a tidier stack.
- **Never depend on another module.** Not as a dependency, not as a peer, not in an example that
  would make it load-bearing. The only permitted runtime dependency is the `@xano/sdk` peer.
- **A test may not raise the peer floor.** The suite uses only what the floor (1.0.0) exports.
  `test/helpers.ts` recomputes `md5("<kind>:<name>")` itself rather than importing `deriveGuid`
  from `@xano/sdk/internal`: that subpath is compiler machinery, not authoring surface, so the
  peer window makes no promise about its shape, and importing it would tie the suite to one SDK
  version instead of the whole window. Check the rule after any floor move: a helper that mirrors
  an SDK internal must still match what every version in the window computes.
- **The `"xanosdk"` block in `package.json` declares `register` and `returns` and omits `options`,
  on purpose.** `registerPasswordReset` needs `authTable`, `resetUrl` and `fromEmail`, and the
  last two can only be answered by the consumer. `options` is all or nothing: declaring just
  `authTable` would be read as the whole argument and get a call written that does not compile.
  Omitted, `xanosdk init --marketplace` reads the function's arity, keeps the module out of the
  generated `xano/index.ts`, and leaves a commented call. `returns` is `"handle"` because the
  returned def set is the only route to the registered defs.
- **Deviations are documented at the deviation.** Any place this module departs from the obvious
  behaviour gets a header comment naming the hazard, an assertion, and a line in this file.

Module-specific, and each one is load-bearing:

- **`statements(...)` does NOT go in a nested block.** It returns a `readonly` tuple, and
  `s.conditional`'s `then` and `s.foreach`'s `body` are typed `Statement[]` - mutable - so it
  fails with TS4104. Use a plain array literal there. The widening rule is about the QUERY's own
  `stack`, which must stay a literal tuple; a nested block is `Statement[]` by the engine's own
  shape and has no tuple to lose. (The rules pack's "two explicit `statements(...)` branches for
  a conditional" is about a conditional at the STACK level, not about a block's body.)
- **The limiter is DISABLED, never absent, when `rateLimit: false`.** `rateLimitStatement()`
  returns one `Statement` and sets `disabled: true`. A conditional spread would have collapsed
  every stack's tuple - the exact failure `test/types.test.ts` exists to catch - and the disabled
  step is visible in the Xano UI, so a reader of the deployed endpoint can see the limiter exists
  and was opted out of.
- **`POST password_reset/request` MUST answer `{ ok: true }` unconditionally.** It is not a stub.
  Making it 404 on an unknown address turns an unauthenticated endpoint into an account
  enumeration oracle. Everything address-dependent lives inside the conditional, and nothing
  follows it in the stack, so there is no shared statement whose timing or presence could differ.
- **The lookup and the conditional run in `s.util.post_process`, never inline.** A constant body
  is not enough: inline, a known address mints a token, writes a row and calls the mail provider
  before the response, and an unknown one does not, so the response TIME answers the question
  the body refuses to. Before the response there are the two limiters and nothing else;
  `test/queries.test.ts` asserts exactly that. Like a conditional's `then`, `post_process`
  takes a plain `Statement[]` array, positionally.
- **A reset does not revoke auth tokens, and cannot.** Xano auth tokens are stateless, and this
  module neither mints nor verifies them. `confirm` revokes the other outstanding RESET tokens;
  the session limit is documented in `README.md` and `llms.txt` rather than half-solved here.
- **`confirm` and `validate` share ONE rejection message** for unknown, spent and expired. Same
  reason. `test/queries.test.ts` asserts the three messages are one distinct string.
- **`confirm` spends the token BEFORE it writes the password.** The other order leaves a usable
  token behind after a successful reset.
- **The `token` column is `access: "internal"`, and no endpoint names it in an `output` list.**
  `output` OVERRIDES column visibility and is the only way to read an internal column - which is
  why the probe has to do it, and why the shipped endpoints must not.
- **The token is minted by `s.security.create_uuid`, never `create_guid`.** `create_guid` is an
  internal statement XanoScript cannot spell, so it does not survive a pull, and the SDK does not
  expose it: a def that calls it throws `create_guid is not a function` at
  `createPasswordReset()`. `create_uuid` is available across the whole peer window. Its output is
  hex and dashes: still url-safe and HTML-safe unescaped, which `email-template.ts` relies on.
- **Take the new password as `input.text`, never `input.password`.** `input.password` hashes at
  BIND time; the `f.password()` column then sees a value already in `salt.hash` shape, skips its
  own hash-on-write, and stores it verbatim - so login never matches what the user typed. Proven
  on a live instance, below.

## Facts verified against a live instance

<!--
  Record what a live probe establishes, DATED, with the core version. Keep
  results that contradict an earlier note, and mark the old claim wrong in
  place rather than deleting it - so nobody repeats the dead end.

  Two facts already paid for elsewhere, do not re-derive them:
  - Agent tools work on an INSTANCE workspace, not on an ephemeral. The same
    bundle fails on an ephemeral with "Toolset with that canonical doesn't
    exist or is disabled".
  - If deploy reports "must be owner of table mvpw1_N", delete
    .xano/ephemeral.json and deploy again.
-->

The golden fixture proves the ENCODING. `s.util.send_email` is exactly the kind of statement it
cannot speak for, so the flow is probed rather than assumed.

The probe lives at `local-files/probe/index.ts` (gitignored, outside tsconfig's `include`). It
seeds one user, registers this module, and adds probe-only endpoints: `probe/token` reads the
token back out of the `internal` column - which is what `output` is for, and what the shipped
endpoints deliberately never do - and `probe/check` checks a password so a reset can be proven
to have taken effect. Because it is gitignored it does not survive a fresh clone; recreate it
from that description when it is missing.

```bash
npx xanosdk deploy ./local-files/probe/index.ts --expires-hours 3 --no-lock
# PROBE_PROVIDER=resend PROBE_FROM=you@verified-domain.com  npx xanosdk deploy ...
```

`--no-lock` keeps the probe from writing a `xano.lock` into `local-files/`. The API group
canonicals are then minted by the instance: read them back with
`xanosdk ephemeral export <name> --path -`.

### 2026-08-31 - ephemeral `esjr-o5l9-f685`, SDK 0.0.10

- **`s.util.send_email` reports a result on its `as` - and `status: "success"` means QUEUED,
  not delivered.** It binds `{ id?, status, error?, remaining? }`. The status catches
  CONFIGURATION failures (`"Workspace admin not found"`, `"Missing required field for Send
  Email."`) and nothing else: a send to `not-an-address` - not even a syntactically valid
  address - returns `{"id":"362ba30c-…","remaining":85,"status":"success"}` and decrements the
  quota. So the status can tell you the statement was mis-set up; it can NEVER tell you a
  message arrived, or that the recipient exists.
  Do not conclude a send succeeded from the endpoint's HTTP 200 either: the endpoint returns a
  CONSTANT, so 200 proves only that the stack ran. **The only oracle for delivery is the
  recipient's inbox, or a provider with its own delivery log** - which is a real argument for
  `"resend"` over `"xano"` in anything you have to operate.
- **The quota is 100 sends** on this instance (`remaining` counts down per send, and counts
  down for a rejected recipient too).
- **The built-in `"xano"` mailer DOES NOT WORK ON AN EPHEMERAL.** Every send returns
  `status: "error"`, `error: "Workspace admin not found"` - it sends as the workspace admin, and
  an ephemeral tenant has none. Passing an explicit `from` does not help. So an ephemeral probe
  can only exercise `"resend"`; `"xano"` has to be probed on an instance workspace. Same shape
  as the known agent-tools limitation above.
- **`to` must be a SCALAR.** A one-element list (`fl.safe_array()`) fails the request with HTTP
  400 `Text filter requires an integer, float, string or boolean value`, naming `param: to`.
  There is no multi-recipient form on that field; `cc`/`bcc` are separate fields.
- **`"resend"` with no key in the workspace environment fails GENERICALLY** - `status: "error"`,
  `error: "Missing required field for Send Email."`. It does not name `api_key`, so an unset
  `RESEND_API_KEY` reads as a malformed statement. Check the env var first on that string.
- **The rest of the flow works end to end.** request -> 200 for a known AND an unknown address;
  validate -> 200 with `expires_at`, 400 on a bad token; confirm -> 200; the old password then
  fails `check_password` and the new one passes; a second confirm with the same token -> 400
  with `used_at` set. So the `f.password()` column DOES hash the `input.text` plaintext on
  write - the double-hash trap is genuinely avoided, not merely reasoned about.
- **`s.redis.ratelimit` trips as authored.** The sixth request from one IP inside the window
  returned HTTP 429 with the authored message. The IP bucket and the address bucket are
  independent, as the distinct key prefixes intend.
- **`s.security.create_guid` emits a 27-character url-safe string, not a dashed uuid4.** It goes
  into a URL unescaped either way, but do not document it as a uuid. *(Superseded: the SDK no longer
  exposes `create_guid` and the token is now `s.security.create_uuid` - a dashed uuid4 - see
  below.)*

### Why this module does not branch on the send result

It could - the status is right there on `ref("sent.status")` - and it deliberately does not.
`send_email` is only reached for an address that HAS an account, so any caller-visible
difference between a failed send and no send at all restates exactly the fact the constant
`{ ok: true }` exists to hide. The statement keeps its `as: "sent"` binding so the value is in
the stack for anyone inspecting a run; nothing reads it.

A consumer who needs send failures surfaced should do it in their own workspace - against their
provider's logs - not in a branch here.

### 2026-09-01 - instance workspace 21, SDK 0.0.10 - DELIVERY

- **`"resend"` DELIVERS. `"xano"` does not** - not to a non-admin recipient, on this instance.
  Same workspace, same statement, same non-admin recipient, minutes apart:
  Resend arrived in the inbox; the built-in mailer's messages never appeared, having reported
  `status: "success"` and decremented the quota on every one of them. That asymmetry is the
  whole reason `emailProvider` defaults to `"resend"`.
- **Resend's sandbox sender needs no verified domain.** `from: "onboarding@resend.dev"` works
  out of the box - and delivers ONLY to the address the Resend account is registered under,
  which is exactly what a probe wants. A real deployment still needs a verified domain.
- **The key goes in the workspace env, and `release` is ADD-ONLY on env.** It creates a key that
  does not exist and will NOT update one that does, so rotating a key cannot be done by editing
  code and releasing again. Never a literal, or it lands in the bundle. *(Since SDK 0.0.28 the
  value lives in the gitignored `xano/.env` with the name declared empty in
  `workspaceConfig({ env })`, and since 0.0.42 `xanosdk env set RESEND_API_KEY` rotates it on a
  running backend without a deploy.)*
- **Do not read anything into `"xano"` reporting success.** It counted 12 sends against a
  100-send quota and delivered none of them. See the queued-not-delivered note above; this is
  that note with an inbox attached.

### 2026-09-01 - CONFIRMED: the built-in mailer is admin-only

A paired test went to the workspace admin and to a non-admin in the same second. **The admin
received theirs; the non-admin never did.** So `service_provider: "xano"` sends AS the workspace
admin and delivers ONLY TO the workspace admin.

That is fatal for this module's purpose: a password reset mails whoever asked for it, and that
is a user, never the admin. `"xano"` is kept as an option because the engine offers it and it
is a genuinely useful keyless smoke test - **from the admin's own account** - but it cannot
carry real traffic. `emailProvider` defaults to `"resend"` for this reason, and the option's
own doc comment says so where a consumer will actually read it.

### 2026-09-01 - HTML renders

`message` is passed to the provider as HTML. A full `<!doctype html>` document with inline
styles renders as a styled card in Gmail, verified by screenshot. There is no separate `html`
field and no `text` field on the statement - **one `message`, so an HTML send carries no
plain-text alternative**, which is why `emailFormat: "text"` exists rather than being dropped.

### 2026-09-01 - end to end, through a real browser frontend

A React demo (`local-files/frontend/`, gitignored, NOT part of the package) was published to the
instance static host and `resetUrl` pointed at it, so the emailed link opens a real page.

- **The static host is a DIFFERENT ORIGIN to the API**, and CORS needs no configuration: the
  engine answers the preflight with `access-control-allow-origin` echoing the caller and
  `allow-headers: *`. A static frontend and an instance backend work together as-is.
- **`--static` injects the backend URL into every HTML document** as `window["XANO_HOST"]` -
  bracket form, so grepping `window.XANO_HOST` matches nothing and reads as a failed inject.
  Grep the bare `XANO_HOST` token.
- **Publishing the frontend is a TWO-PASS release.** The static URL is minted by the first
  `release --static`, and `resetUrl` cannot point at a page that does not exist yet: release
  once to learn the URL, then release again with `resetUrl` set to it. *(Since SDK 0.0.22
  `release` is a namespace and no longer publishes a frontend - that is `deploy --static` or
  `xanosdk publish <dir>` now. The two-pass problem is gone for a runtime
  `resetUrl: env("APP_URL")`: publish, then `xanosdk env set APP_URL` - see 2026-09-26 below.)*
- **Set `base: "./"` in the Vite config.** The static host does not necessarily serve from the
  root, and absolute asset URLs 404 there.

The demo is deliberately not shipped. `npm pack --dry-run` shows only `dist/`, the three docs,
`LICENSE` and `package.json`; the integration lives in `llms.txt` as instructions an agent
follows, which cannot go stale against a consumer's own stack the way a shipped component would.

### 2026-09-01 - Resend CLICK TRACKING leaks the token, and breaks the link

Clicking the button in a delivered reset email did not go to the reset page. It went to:

```
https://vw9jhtlx.r.us-east-1.awstrack.me/L0/https:%2F%2Fh7p33a-…%3Ftoken=kRmvxv8tAoPzZEZhrN6yUeo2zQ0/1/…
```

Resend runs on SES, and with click tracking on, **every link in the message is rewritten
through `awstrack.me`** with the original URL - the token included - encoded in the path.

Two consequences, and the second is the serious one:

1. **It breaks the reset for anyone running a blocker.** `awstrack.me` is on standard tracker
   lists; uBlock Origin Lite blocked the navigation outright. Brave, Pi-hole and corporate
   filters do the same. The user cannot reset their password at all.
2. **It hands the token to a third party.** The token is a bearer credential for one account.
   Click tracking puts it in a URL path on AWS's tracking infrastructure, where it is logged and
   retained. Every protection this module has - the `internal` column, single use, the short
   expiry, never returning it from any endpoint - is undone by the delivery layer.

**The module cannot fix this.** `s.util.send_email` exposes no per-send tracking flag and no
custom headers, so it is provider CONFIGURATION: turn click tracking off for the sending domain
in the Resend dashboard. That makes it a documentation obligation rather than a code one, and it
is now stated in `README.md` (read-before-production) and `llms.txt` (agent constraints) rather
than left for a consumer to discover from a bug report.

Worth generalising: a reset link carries a credential, so ANY link-rewriting in the path -
click tracking, a URL shortener, a "safe links" email gateway - is a token disclosure. Say so
wherever the provider is discussed.

### 2026-09-01 - a RUNTIME `resetUrl` resolves, and composes one clean link

`resetUrl` now also takes a `Value`, so `env("APP_URL")` is read when the mail is sent rather
than baked in at export. Probed on ephemeral `enyn-cnxs-7466` (`local-files/probe/runtime-url.ts`),
with `APP_URL` set through `workspaceConfig({ env })` and the module registered with
`resetUrl: env("APP_URL")`:

- **The setting resolves inside the `concat` chain.** `probe/message_text` returned
  `…\n\nhttps://runtime-host.example.dev/reset?token=TOK3N\n\n…` - one URL, not `[object Object]`,
  not an empty string where the value should be.
- **All THREE link sites in the HTML document fill.** Both `href`s and the visible link text
  each came back as the whole `<url>?token=<token>`.
- **The real flow is unaffected.** `POST password_reset/request` for a seeded address answered
  `{"ok":true}` (so the send statement's value evaluated - a malformed chain is a fatal 500),
  the token was minted, and `validate` then `confirm` both answered 200.

Scope of that claim: this probes COMPOSITION. Delivery is unchanged by it - by the time
`send_email` sees the field it is a string like any other - and was not re-probed here, since
the ephemeral mailer cannot send at all (`"xano"` -> "Workspace admin not found") and no Resend
key was available in this environment. Re-run the delivery probe on an instance workspace before
relying on it in production.

The reason the runtime form exists at all: `deploy --static` mints a new host
every run, and a deploy WITHOUT `--static` deletes the one that is serving, so a build-time
`resetUrl` can never address an ephemeral frontend. Setting `APP_URL` after the host is known is
the only ordering that works - and since SDK 0.0.42 `xanosdk env set APP_URL` does that on the
running backend with no redeploy, so the static host stays up.

**Three things it cannot check, all documented on the option:** no query string is allowed (the
`?`-vs-`&` decision needs the URL's content, so the runtime form always appends `?token=`); the
`http(s)` scheme check does not run; and the value is not HTML-escaped, so it lands in an `href`
as-is. A string `resetUrl` keeps all three protections and folds into the document as before -
`bundle.test.ts` stayed byte-identical through this change, which is the proof of that.

### 2026-09-26 - ephemeral `evx7-fayq-245a`, SDK 0.0.46 - the `create_uuid` token

Re-probed after the `create_guid` -> `create_uuid` swap, with `local-files/probe/index.ts` (seeded
user, `emailProvider: "xano"`, probe endpoints `probe/token` and `probe/check`):

- **The token is a dashed uuid4.** `1427d545-f9c9-4f16-890f-a8fb2011f78d` - 36 characters,
  version nibble `4`, variant `8`. It binds through `input.text` and matches the `f.text` column
  with no escaping.
- **The flow is unchanged.** request -> 200 `{ok:true}` for a known AND an unknown address;
  validate -> 200 with `expires_at`, 400 on a bad token; confirm -> 200; the old password then
  fails `check_password` and the new one passes; a second confirm and a validate of the spent
  token -> 400 with the one shared message, and `used_at` is set.
- **The limiter still trips at the sixth request** from one IP inside the window (HTTP 429).
- **All three endpoints take POST**, including `validate` - a GET 404s at the router
  (`Unable to locate request.`), which reads like a bad token if you only look at the status.
- **`xanosdk env set APP_URL --to ephemeral:<name>` writes one variable on the running backend.**
  The ephemeral's exported workspace then carried `APP_URL` with the value set, and the reset
  endpoints kept answering - no deploy, nothing torn down.
- **Declaring any env var turns on `stack.env-undeclared`.** A workspace config declaring only
  `OTHER` fails `export({ strict: true })` on this module's `env("RESEND_API_KEY")` and
  `env("APP_URL")`; declaring both clears it. README and `llms.txt` tell consumers to declare
  them.

### 2026-10-04 - ephemeral `e3bg-xmee-bc6b`, SDK 1.0.0 - `request` answers before it looks

Probed after the lookup and the conditional moved into `s.util.post_process`:

- **`post_process` runs AFTER the response is sent.** A probe endpoint whose only statement is
  `post_process([s.util.sleep(3)])` answered in ~0.22s, three times running.
- **It still sees the request.** `inp("email")` binds inside it: a known address got its token
  row (read back through `probe/token`), and validate -> confirm -> `check_password` then worked
  exactly as before, including the 400 on a second confirm.
- **Known and unknown addresses now time the same.** 20 alternating pairs with `rateLimit: false`:
  known mean 0.235s, unknown 0.224s, every response 200 `{"ok":true}`; the known mean carries one
  0.36s outlier and the medians match. The ephemeral mailer fails fast (`"xano"` cannot send
  there), so this UNDERSTATES the old gap - a real Resend call is an outbound HTTPS round trip -
  and the sleep probe above is the proof that carries the claim.

### Not yet probed

- **Rendering outside Gmail.** The document is table-based with inline styles for exactly this
  reason, but Outlook, Apple Mail and the mobile clients have not been looked at.
- **Deliverability from a verified domain.** Everything so far went through Resend's sandbox
  sender `onboarding@resend.dev`, which only reaches the Resend account owner.
- **A runtime `resetUrl` through a real DELIVERY.** Its composition is verified live (above);
  the mail carrying it has not been sent through Resend from an instance workspace.

## The peer range

- `peerDependencies`: `>=1.0.0 <2.0.0` - floor and ceiling, written out. The ceiling is the
  next major; the floor is currently 1.0.0.
- `devDependencies`: `1.0.0` - **exact, no caret**. It is the single version the
  golden fixture was generated against.

Versions start at 1.0.0 and only increment 1.0.x for now, regardless of the change. Do not bump
unless told to.

The two numbers move independently. Raise the FLOOR only when a new core type or behaviour
becomes load-bearing here, and verify it by installing that version and running the suite -
needlessly raising it forces consumers into an upgrade that buys them nothing.

## The golden-bundle contract

`test/fixtures/golden-bundle.json` is the exact bytes this module encodes to. It is the
peer-drift tripwire: a core bump that changes the encoding fails HERE rather than in a
consumer's workspace.

**Regenerating it is a deliberate, reviewed act - never a way to make a red test go green.** A
failure means the bundle moved. Find out why first, then:

```bash
npm run fixture:regen && git diff test/fixtures/golden-bundle.json
```

Read that diff line by line: guids, auth flags, stack order, output lists.

The golden config turns **every** feature on, and `bundle.test.ts` asserts that coverage - a
tripwire only guards what it encodes, so the config cannot quietly narrow while staying green.

## Release

1. Read the core diff first - `llms.txt` and `README.md` between the two versions. A green
   suite proves no ENCODING drift; it does not prove this module still follows current guidance.
2. Move the dev pin (exact). Move the peer floor only if something new became load-bearing, and
   verify by installing that version and running the suite.
3. `npm run typecheck && npm run lint && npm test`.
4. Regenerate the golden fixture **only** if the bundle legitimately changed. An unchanged
   fixture is the expected outcome of most bumps.
5. Update both numbers in `README.md` AND `llms.txt`, in the same commit.
6. Publish from a green tree on the default branch, after the PR merges:

```bash
npm version patch -m "chore(release): %s"   # per README "Versioning"
npm run release          # prepublishOnly rebuilds dist/
git push --follow-tags
```

If the version bump already landed in the PR, skip `npm version` and tag instead:
`git tag vX.Y.Z` on the merged `main`, then `npm run release` and `git push --follow-tags`.

`npm pack --dry-run` must show exactly `dist/` (no maps), `README.md`, `AGENTS.md`,
`llms.txt`, `LICENSE`, `package.json` - and `test/published-docs.test.ts` should have told
you first.

### Release notes

Start from `.github/RELEASE_TEMPLATE.md`. The release NAME becomes the Slack header verbatim
(`vX.Y.Z - Three-to-five word theme`); everything before the first `##` is the summary block;
each change gets its own `##` heading, written as a claim that survives with no body under it.

## Then list it

npm and the marketplace are separate acts: npm is the package, a listing is a pointer to it. A
module can be perfect and invisible.

1. Add a `PLUGIN_SEEDS` entry to `xano/content/modules.ts` in the marketplace repo. The factory
   checks its shape: `npm_package` must be the PACKAGE name (that is what
   `xanosdk marketplace install` takes, not the slug), `includes` must be one row per Xano object
   rather than prose (the detail page groups and counts it), and each `requirements` entry must
   be an OBJECT - a list-of-text column splits every element on its commas at bind, so a bare
   string arrives as two rows.
2. Seed it. **A release cannot carry table rows** - the exported bundle has none, `--seed` has
   nothing to write, and `--replace` refuses `--seed` outright - so the listing goes in over the
   public API afterwards, and the script is idempotent:

```bash
cd ../marketplace
node --experimental-strip-types scripts/seed-listings.mjs <baseUrl>
```

3. Verify with `xanosdk marketplace details @xano-sdk/password-reset --prompt`, and re-run
   `factory status --only password-reset` - the marketplace checks read the seed file directly.
