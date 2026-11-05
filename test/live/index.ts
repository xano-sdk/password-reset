// The workspace `npm run test:live` deploys. The `live/*` endpoints exist only here: they stand in for the
// app's own sign-up and login, and for the reset email a test cannot read.
import { apiGroup, c, expr, f, inp, input, query, ref, s, table, workspace, col } from "@xano/sdk";
import { registerPasswordReset } from "../../src/index.js";

const user = table({
  name: "live_user",
  auth: true,
  useXdo: false,
  schema: { email: f.email({ required: true }), password: f.password({ required: true }) },
  index: [{ type: "unique", fields: [{ name: "email" }] }],
});
const live = apiGroup({ name: "Live", canonical: "live" });
const app = workspace("password-reset-live").registerTables([user]).registerApiGroups([live]);
const { tokenTable } = registerPasswordReset(app, {
  authTable: user,
  resetUrl: "https://app.example.com/reset",
  emailProvider: "xano",
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
