// The workspace `npm run test:live` deploys. The `live/*` endpoints exist only here: they stand in for the
// app's own sign-up and login, and for the reset email a test cannot read.
//
// `LIVE_MAIL_URL` installs the module with a custom `sendEmail` that posts to that address, which is the
// script's own capture server. Without it, the built-in mailer, which delivers nothing on a local engine.
import { apiGroup, c, env, expr, f, inp, input, obj, query, ref, s, table, workspaceConfig, col, Xano } from "@xano/sdk";
import { registerPasswordReset, type ResetEmail } from "../../src/index.js";

const user = table({
  name: "live_user",
  auth: true,
  useXdo: false,
  schema: { email: f.email({ required: true }), password: f.password({ required: true }) },
  index: [{ type: "unique", fields: [{ name: "email" }] }],
});
const live = apiGroup({ name: "Live", canonical: "live" });
const app = new Xano()
  .registerWorkspace(workspaceConfig({ name: "password-reset-live", env: { LIVE_MAIL_KEY: "" } }))
  .registerTables([user])
  .registerApiGroups([live]);
const mailUrl = process.env.LIVE_MAIL_URL;
const { tokenTable } = registerPasswordReset(app, {
  authTable: user,
  resetUrl: "https://app.example.com/reset",
  ...(mailUrl === undefined
    ? { emailProvider: "xano" as const }
    : {
        fromEmail: "Live <live@example.com>",
        emailSubject: 'Reset "your" password',
        sendEmail: ({ to, fromEmail, subject, html, text, resetLink }: ResetEmail) =>
          s.api.request({
            url: mailUrl,
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Mail-Key": env("LIVE_MAIL_KEY") },
            params: obj({ from: fromEmail, to: [obj({ email: to })], subject, body: obj({ html, text }), resetLink }),
          }),
      }),
  // Still on, but roomy: the counters outlive a deploy, and one run makes more calls than the default allows.
  rateLimit: { max: 1000, ttl: 60 },
  canonical: "password_reset",
});

const addUser = query({
  name: "live/user",
  verb: "POST",
  apiGroup: live,
  input: { email: input.email({ required: true }), password: input.text({ required: true }) },
  stack: [s.db.add({ table: user, row: { email: inp("email"), password: inp("password") }, as: "row" })],
  response: { ok: c.bool(true) },
});
const login = query({
  name: "live/login",
  verb: "POST",
  apiGroup: live,
  input: { email: input.email({ required: true }), password: input.text({ required: true }) },
  stack: [
    s.db.get({ table: user, fieldName: "email", fieldValue: inp("email"), output: ["id", "password"], as: "row" }),
    s.security.check_password({ text_password: inp("password"), hash_password: ref("row.password"), as: "match" }),
  ],
  response: { match: ref("match") },
});
const latestToken = query({
  name: "live/token",
  verb: "POST",
  apiGroup: live,
  input: { email: input.email({ required: true }) },
  stack: [
    s.db.get({ table: user, fieldName: "email", fieldValue: inp("email"), output: ["id"], as: "row" }),
    s.db.query({
      table: tokenTable,
      where: expr(col("owner"), "=", ref("row.id")),
      sort: [{ sortBy: "id", dir: "desc" }],
      output: ["token"],
      returnType: "single",
      as: "latest",
    }),
  ],
  response: ref("latest"),
});

export default app.registerQueries([addUser, login, latestToken]);
