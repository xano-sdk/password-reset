# @xano-sdk/password-reset

Token-based password reset for a Xano SDK workspace, as typed def objects: a
single-use token table, three public endpoints, and the reset email sent with
`s.util.send_email` through **Resend** or Xano's built-in mailer.

There is no runtime. `table()`, `query()` and `apiGroup()` are identity
functions - this package hands your `Xano` instance def objects, and your
`export()` does all the encoding.

**Authentication is not included.** This resets a password on a table you
already have. Pair it with [`@xano-sdk/auth`](https://www.npmjs.com/package/@xano-sdk/auth),
or with your own signup/login stack - it depends on neither.

## Install

```bash
npm install @xano-sdk/password-reset @xano/sdk
```

`@xano/sdk` is a **peer dependency**, range `>=1.0.0 <2.0.0`. One shared copy
only, or the statement and kind registries fork. This package is **tested
against 1.0.0** exactly - the version its golden bundle fixture was generated
against.

`xanosdk marketplace install @xano-sdk/password-reset` (and `xanosdk init --marketplace`) installs
the package but does not write the `registerPasswordReset` call: it needs `authTable`, `resetUrl`
and `fromEmail`, which only you can answer. `init --marketplace` leaves a commented call in
`xano/index.ts` naming the package; fill it in as in the Quickstart below.

For Resend, set the API key as a **workspace environment variable** (default
name `RESEND_API_KEY`). It is read server-side with `env()`, so it never enters
the bundle and cannot reach a frontend build. Declare the name, empty, in your
workspace config and keep the value in the gitignored `xano/.env`:

```ts
import { Xano, workspaceConfig } from "@xano/sdk";

const app = new Xano().registerWorkspace(
  workspaceConfig({ name: "my-app", env: { RESEND_API_KEY: "" } }),
);
```

To change the live value without a deploy: `xanosdk env set RESEND_API_KEY`
(the value is read from stdin). Once your config declares any env var, `export()`
warns about every `env()` name it does not declare - this package reads
`RESEND_API_KEY`, and `APP_URL` if you use the runtime `resetUrl` below - so
declare the ones you use.

## Quickstart

```ts
// xano/index.ts
import { workspace, table, f } from "@xano/sdk";
import { registerPasswordReset } from "@xano-sdk/password-reset";

const userTable = table({
  name: "user",
  auth: true,
  schema: { email: f.email({ required: true }), password: f.password({ required: true }) },
  index: [{ type: "unique", fields: [{ name: "email" }] }],
});

const app = workspace("my-app").registerTables([userTable]);

const reset = registerPasswordReset(app, {
  authTable: userTable,
  resetUrl: "https://app.example.com/reset",
  fromEmail: "no-reply@your-verified-domain.com",
  canonical: "password_reset",
});

export default app;
```

The flow:

1. The user posts their address to `password_reset/request`.
2. This package mints a random UUID token, stores it with an expiry, and mails
   `<resetUrl>?token=<token>`.
3. Your page at `resetUrl` reads `?token=`, optionally calls
   `password_reset/validate` so it can say "this link has expired" before
   showing the form, and posts the token plus the new password to
   `password_reset/confirm`.
4. The user logs in through your ordinary login endpoint. **Confirm mints no
   session** - resetting a password is not the same act as logging in, and a
   confirm that returned a token would let anyone who reads the mailbox skip
   login entirely.

## Working with an auth table

`authTable` takes **any** table def handle. This package declares no user table
and depends on no other package.

It requires three things of that table and nothing else: `table({ auth: true })`,
an address column (default `email`, rename with `emailColumn`), and an
**`f.password()`** column (default `password`, rename with `passwordColumn`).

**The password column must be `f.password()`, and that is enforced.** Confirm
writes the submitted password as plaintext and relies on the column to hash on
write, so an `f.text()` column would store every reset password in the clear -
deploying clean, answering 200, with no symptom but a readable database.
`resolveOptions` refuses it, names the type it found, and says why. Both column
names are checked against the schema too, and both are reported at once.

### With `@xano-sdk/auth`

Its defaults are already the ones this module expects, so there is nothing to
configure:

```ts
const app = registerAuth(workspace("my-app"), { canonical: "authn" });

registerPasswordReset(app, {
  authTable: userTable,            // auth's handle, not a name
  resetUrl: "https://app.example.com/reset",
  fromEmail: "no-reply@your-verified-domain.com",
  canonical: "password_reset",
});
```

Verified against a real install of both packages: the API groups coexist, no
guid collides, auth's own endpoints are untouched, and the token table's `owner`
resolves to auth's `user` guid.

Note that `@xano-sdk/auth` is singleton-shaped, so `registerAuth` can be called
once per process - a test file building two workspaces with it fails on the
second. This package is factory-shaped and has no such limit.

### With your own auth table

Name the columns if they differ - `emailColumn` and `passwordColumn` - and
nothing else changes. Your login endpoint keeps working: this module only ever
writes the password column, and it mints no session, so after a reset the user
signs in through whatever you already had.

## Endpoints

All three are **public**. A caller who could authenticate does not need any of
them, so none binds an auth table.

### POST `password_reset/request`

Input `{ email }`. Response `{ ok: true }` - **for an address with an account
and for one without, identically**.

That is a security property, not a stub. The endpoint is unauthenticated, so
anything that differed by case would let anyone ask it whether anyone else has
an account. Everything address-dependent happens inside a conditional and
nothing about it reaches the caller.

Rate limited twice, in separate buckets: once per caller IP (which stops one
host harvesting addresses) and once per submitted address (which stops one
victim's inbox being flooded from many hosts).

### POST `password_reset/validate`

Input `{ token }`. Response `{ ok: true, expires_at }`, or **400** with
`"This reset link is not valid. Request a new one."`.

Read-only: it does not spend the token. A POST rather than a GET on purpose - a
GET puts the token in a URL, and a URL travels into access logs, proxies, and
the `Referer` header of every asset the page then loads.

### POST `password_reset/confirm`

Input `{ token, password }` (password minimum 8 characters). Response
`{ ok: true }`, or **400** with the same sentence as above.

The password is taken as `input.text`, not `input.password`: an `input.password`
hashes at bind time, the `f.password()` column would then see a value already in
`salt.hash` shape and store it verbatim, and login would never match what the
user typed. The **column** does the hashing.

In order: guard existence, guard single-use, guard expiry, spend the token,
write the password, then mark every other outstanding token for that account
used. The token is spent **before** the password is written - the other order
leaves a usable token behind after a successful reset.

## Tables

### `password_reset_token`

| Column | Type | Notes |
|---|---|---|
| `id`, `created_at` | int, epochms | auto-injected by core |
| `owner` | tableRef → your auth table | required, btree-indexed |
| `token` | text | required, **`access: "internal"`**, unique index |
| `expires_at` | epochms | required |
| `used_at` | epochms | nullable; non-null means spent |

`token` is `internal`, so it is absent from every API response even from a read
that returns the whole row - it is a bearer credential for one account. No
endpoint here names it in an `output` list, which is the only way to read an
internal column back.

`use_xdo` is pinned to `false` rather than inheriting the consumer workspace's
setting, so the storage mode does not change depending on whose workspace it
lands in.

## Options

| Option | Default | Why |
|---|---|---|
| `authTable` | **required** | The table whose password is reset. Pass the def HANDLE. |
| `resetUrl` | **required** | Your page. `<resetUrl>?token=<token>`, or `&token=` when it already has a query string. A string must be `http:`/`https:` and is resolved at export time; a `Value` (`env("APP_URL")`) is resolved at request time. On an ephemeral, see [On an ephemeral, point `resetUrl` at your local dev server](#on-an-ephemeral-point-reseturl-at-your-local-dev-server). |
| `fromEmail` | **required for Resend** | Resend refuses a sender on an unverified domain. Optional for `"xano"`. |
| `emailProvider` | `"resend"` | `"xano"` is the built-in mailer - no key, no verified sender. |
| `apiKeyEnv` | `"RESEND_API_KEY"` | Workspace env var, read with `env()`. Ignored for `"xano"`. |
| `tokenTtlSeconds` | `3600` | Bounded 60s..7d. |
| `rateLimit` | `{ max: 5, ttl: 900 }` | `false` opts out; the step stays in the stack, disabled. |
| `emailSubject` | `"Reset your password"` | Also the heading inside the email. |
| `emailIntro` | names the expiry in minutes | The line above the button. |
| `emailOutro` | "if you did not ask for this…" | The line below the rule. |
| `emailFormat` | `"html"` | `"text"` sends plain text. One `message` field on the engine, so HTML carries no text alternative. |
| `emailButtonLabel` | `"Choose a new password"` | HTML only. |
| `brandName` | unset | A short product name above the heading. Omitted entirely when unset. |
| `brandColor` | `"#18181b"` | Button and link colour. Hex only - it lands in a `style` attribute. Button text is white, so pick something with contrast. |
| `emailColumn` | `"email"` | Checked against `authTable`'s schema at option time. |
| `passwordColumn` | `"password"` | Same. |
| `canonical` | unset | Pin it when `getPath()` must resolve with no lock file. |
| `history` | `false` | Request history stores request BODIES - a token and a plaintext password. |

Every rejection comes from `resolveOptions`, before any def is built, and names
the option that was wrong. A wrong `emailColumn` is a sentence here rather than
a stack trace through core's `expandRow`.

## The email

HTML by default: a single card, a heading, your intro, a button, the link again
as copyable text, and your outro under a rule. Table-based layout with every
style inline, because Outlook renders through Word's HTML engine and a `div`
layout collapses there while looking fine everywhere you tested. Dark mode is a
`prefers-color-scheme` override on top of the inline light styles, so stripping
the `<style>` block leaves a correct email rather than an unreadable one.

The link appears **twice** - once as the button's `href`, once as text a reader
can copy. A single-button email is unusable for anyone whose client strips
links, and "click the button" with no visible URL is exactly the shape people
are taught not to trust.

Every value you supply - `brandName`, `emailSubject`, `emailIntro`,
`emailOutro`, `emailButtonLabel` - is HTML-escaped into the document. That is a
correctness boundary rather than a security one, since these come from your
config and not from a request, but it means an ampersand in your product name
does not break the markup.

### Testing without a Resend account

`emailProvider: "xano"` uses Xano's built-in mailer and needs **no API key and
no configuration**. The catch, confirmed on a live instance: it sends as the
workspace admin and **delivers only to the workspace admin**.

So it is a real smoke test with one condition attached:

- **If you are the admin of the instance** - which is the common case for
  someone building on their own workspace - set `emailProvider: "xano"`, request
  a reset for your own address, and you will get the email. No account, no key,
  no domain.
- **If you are not**, find out the workspace admin's address and test against
  that, or get your own Resend key. Testing against any other address will look
  like it worked and deliver nothing.

Either way, ship on `"resend"`.

## The frontend

This package ships **no frontend files**, and no component library is involved.
You need one page, whose URL is the `resetUrl` option. It does two jobs
depending on whether the URL carries a `?token=`: without one it collects an
address, with one it collects a new password.

`llms.txt` carries the full integration - an `api.ts`, the page outline, and the
typed-body imports. The rules that page must follow, because each is a property
of the endpoints rather than a preference:

1. After requesting, show the **same** screen for every address. The endpoint
   refuses to say whether an account exists so the page cannot leak it.
2. Call `validate` **on mount**, before rendering the password fields - so an
   expired link is reported before the user types a password twice.
3. The token goes in a POST body and nowhere else: not stored, not in a header,
   not back into the URL, not into analytics.
4. `confirm` mints no session. Send the user to your login page afterwards.
5. Show the server's message verbatim. The three rejections share one sentence
   on purpose; mapping them to specific ones in the UI undoes that.

CORS needs no configuration - the engine answers the preflight from any origin,
so a static-hosted frontend and an instance backend work together as-is.

### On an ephemeral, point `resetUrl` at your local dev server

A string `resetUrl` is resolved at **export** time - it is baked into the email
body as a build-time constant. `xanosdk deploy --static` mints a **new static host on every
run**, so on an ephemeral environment the emailed link can never address the
frontend that is currently serving: deploy N can only carry deploy N-1's URL.

The obvious escape route does not exist. A deploy **without** `--static` REMOVES
the frontend rather than leaving it alone, so "deploy `--static` to learn the
host, then redeploy the backend carrying it" takes the whole app down:

```
deploy --static      -> https://5ndw94-....dev.xano.io   200
deploy (no --static) -> that same static host now        404
deploy --static      -> https://hfplbv-....dev.xano.io   200   (a different URL)
```

So on an ephemeral, run the UI locally against the deployed backend:

```ts
resetUrl: "http://127.0.0.1:5173/",
```

Have the page read `?token=` from the app root, so no history fallback is
needed. Pass your real frontend URL when you deploy to an instance workspace,
where the frontend URL does not move.

### Or resolve `resetUrl` at request time

`resetUrl` also takes a `Value`, read when the mail is sent rather than when the
workspace is built:

```ts
import { env } from "@xano/sdk";

registerPasswordReset(app, { authTable: userTable, resetUrl: env("APP_URL"), fromEmail });
```

Declare `APP_URL` in `workspaceConfig({ env })`. After a `--static` deploy has
minted its host, set the variable on the running backend with no redeploy:

```bash
printf %s "https://<the-static-host>/" | npx xanosdk env set APP_URL
```

The emailed link then addresses the frontend that is actually serving. Run it
again after each `--static` deploy, since each one mints a new host. Three
constraints come with the runtime form, none checkable at build time:

- **No query string** - the runtime form always appends `?token=`, because the
  `?`-vs-`&` decision needs the URL's content.
- **No scheme check** - the `http:`/`https:` refusal runs on a string only.
  Write access to that variable is write access to a link your users trust.
- **Not HTML-escaped** - in `emailFormat: "html"` the value lands in an `href`
  and in the visible link text unescaped.

A plain string stays the right answer wherever the frontend URL is stable: it is
validated, escaped, and folded into the document, emitting the identical bundle
it always has. Note that a `release`/`promote` is **add-only** on the workspace
environment - it will not update a variable that already exists, so change
`APP_URL` with `xanosdk env set` rather than by releasing again.

## Identity & the lock

This package pins **no guid**. Identity derives from `(type, name)` -
`md5("<kind>:<name>")` - and belongs to **your** `xano.lock`. Commit it: a
rename without the lock makes the engine DELETE and recreate the object rather
than renaming it in place, and the rows go with it.

`canonical` is the one identity knob, and it is yours to pass. It is a public
URL token, so changing it moves every path in the wild.

## Cherry-picking individual defs

`createPasswordReset(options)` builds the def set without registering it, so you
can register a subset:

```ts
const defs = createPasswordReset({ authTable: userTable, resetUrl, fromEmail });
app.registerTables([defs.tokenTable])
   .registerApiGroups([defs.group])
   .registerQueries([defs.requestQuery, defs.confirmQuery]);   // no validate
```

Two `createPasswordReset()` calls are fully independent - nothing is shared
between them. Registering two def sets sharing names onto one workspace still
fails at `export()`, which is what the `WeakSet` guard on `registerPasswordReset`
turns into a readable error.

## Response shapes

Every endpoint's response is **derived** by core's static walk from the stack,
not declared. A declared `responseShape` OVERRIDES derivation and is never
cross-checked, so it becomes a hand-maintained contract that drifts from the
`output` list in silence. Nothing here declares one, which means editing an
endpoint's stack moves the consumer-visible type with it.

## Read before production

An honest list. None of these is a bug; each is a limit you should know before
you rely on it.

- **A `{ ok: true }` from `request` does not mean an email was sent**, and
  neither does `send_email`'s own `status: "success"`. That status means the
  message was QUEUED - it comes back even for a recipient that is not a valid
  address at all - so it catches a misconfigured statement and nothing else.
  This package deliberately does not branch on it: the send is only attempted
  for an address that HAS an account, so any caller-visible difference between a
  failed send and no send restates exactly the fact the constant response exists
  to hide. **The only oracle for delivery is your provider's log**, which is a
  real argument for `"resend"` over `"xano"` in anything you operate.
- **`emailProvider: "xano"` cannot carry real traffic.** The built-in mailer
  sends as the workspace admin and delivers **only to the workspace admin** -
  confirmed by a paired send: the admin received their copy, a non-admin never
  did, and both reported `status: "success"`. A password reset mails whoever
  asked, so `"xano"` will silently deliver nothing to every caller who is not
  the admin. It is kept for the keyless smoke test described above, and for
  nothing else.
- **On an ephemeral environment `"xano"` fails outright**, with
  `"Workspace admin not found"` - an ephemeral tenant has no admin to send as.
- **The email is HTML, and there is no plain-text alternative.** The engine's
  statement has one `message` field, so an HTML send is HTML only. Clients that
  refuse HTML get the markup. `emailFormat: "text"` exists for that case.
- **Turn OFF click tracking on your sending domain.** This is the one item on
  this list that is a security bug if you skip it. Resend (and SES, Mailgun,
  SendGrid, Postmark) rewrite every link in a message through a tracking domain,
  with the original URL - **and therefore the token** - encoded in the path.
  Observed in a real send: the button went to
  `https://…awstrack.me/L0/https:%2F%2F…%3Ftoken=<the token>/1/…`.
  Two things follow. The link is blocked outright by uBlock, Brave, Pi-hole and
  corporate filters, so a user with a blocker cannot reset their password at
  all. And the token - a bearer credential for one account - is handed to a
  third party and logged there, which undoes the `internal` column, the single
  use, and the short expiry in one step. This module cannot prevent it:
  `s.util.send_email` has no per-send tracking flag, so it is a setting on your
  sending domain. The same applies to any URL shortener or "safe links" email
  gateway in the path.
- **Deliverability depends on your sender and link domains being coherent.** A
  message from a shared sandbox sender, with the subject "Reset your password"
  and a link to a domain unrelated to the sender, is close to a textbook
  phishing signature and gets filtered. Verify your own domain in Resend, send
  from it, and put `resetUrl` on it.
- **An unset `RESEND_API_KEY` fails generically.** The engine answers
  `"Missing required field for Send Email."` without naming `api_key`, so a
  missing workspace environment variable reads as a malformed statement. Check
  the variable first when you see that string, and set it with
  `xanosdk env set RESEND_API_KEY`.
- **Spent and expired tokens are never deleted.** The table grows with every
  reset anyone requests. Add a scheduled `task` that deletes rows past their
  expiry if that matters at your volume; this package registers no task, because
  a package that installs a cron into someone else's workspace unasked is worse.
- **The `request` endpoint's timing still differs.** The response body does not
  distinguish a known address from an unknown one, but sending mail takes longer
  than not sending it. A determined attacker can measure that. Closing it needs
  a background send, which is a different design.
- **Rate limiting is per Redis key, not per account.** A distributed caller with
  many IPs still gets `max` attempts per address, which is the bound that
  matters for brute force - but the IP bucket alone will not stop them.
- **Request history is off.** If you turn it on to debug, turn it back off: it
  stores request bodies, which here means tokens and plaintext passwords.
- **The golden fixture proves the ENCODING, not the behaviour.** It cannot see
  what the engine does with the bytes. Mail delivery in particular needs a live
  probe.

## Versioning

Versions start at 1.0.0 and only increment 1.0.x for now, whatever the change, so
`^1.0.0` installs pick up every release. Read the release notes for what each one
changed: a moved peer range, a new option or def, a changed default, a renamed
route, or a narrowed type is called out there.

## License

MIT
