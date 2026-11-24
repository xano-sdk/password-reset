/**
 * The `sendEmail` recipes the docs publish, as code that typechecks.
 *
 * Each region below appears VERBATIM in `llms.txt`, and `senders.test.ts`
 * asserts it. A recipe in prose alone goes stale in silence, and an agent
 * copies it into someone's password reset without ever sending one.
 *
 * Every recipe whose provider has a per-message switch turns click tracking
 * OFF. Dropping that line hands the token to a third party.
 */
import type {} from "@xano/sdk/lambda-globals";
import { c, defineFunction, env, fl, input, inp, obj, s, withFilters } from "@xano/sdk";
import type { PasswordResetOptions } from "../src/index.js";

export type Sender = Pick<PasswordResetOptions, "sendEmail">;

export const sendgrid: Sender = {
  // #region sendgrid
  // env: SENDGRID_API_KEY. `fromEmail` must be a bare address here.
  sendEmail: ({ to, fromEmail, subject, html, text }) =>
    s.api.request({
      url: "https://api.sendgrid.com/v3/mail/send",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "your-app",
        Authorization: withFilters(c.text("Bearer "), fl.concat(env("SENDGRID_API_KEY"))),
      },
      params: obj({
        personalizations: [obj({ to: [obj({ email: to })] })],
        from: obj({ email: fromEmail, name: c.text("Your App") }),
        subject,
        content: [
          obj({ type: c.text("text/plain"), value: text }),
          obj({ type: c.text("text/html"), value: html }),
        ],
        tracking_settings: obj({ click_tracking: obj({ enable: c.bool(false), enable_text: c.bool(false) }) }),
      }),
    }),
  // #endregion sendgrid
};

export const postmark: Sender = {
  // #region postmark
  // env: POSTMARK_SERVER_TOKEN
  sendEmail: ({ to, fromEmail, subject, html, text }) =>
    s.api.request({
      url: "https://api.postmarkapp.com/email",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "your-app",
        "X-Postmark-Server-Token": env("POSTMARK_SERVER_TOKEN"),
      },
      params: obj({
        From: fromEmail,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        TrackLinks: c.text("None"),
      }),
    }),
  // #endregion postmark
};

export const mailgun: Sender = {
  // #region mailgun
  // env: MAILGUN_API_KEY. EU accounts use https://api.eu.mailgun.net
  sendEmail: ({ to, fromEmail, subject, html, text }) =>
    s.api.request({
      url: "https://api.mailgun.net/v3/mg.your-domain.com/messages",
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
        "User-Agent": "your-app",
        Authorization: withFilters(
          c.text("Basic "),
          fl.concat(withFilters(c.text("api:"), fl.concat(env("MAILGUN_API_KEY")), fl.base64_encode())),
        ),
      },
      // A plain object, not `obj()`, which refuses a key with a colon in it.
      params: { from: fromEmail, to, subject, html, text, "o:tracking-clicks": "no" },
    }),
  // #endregion mailgun
};

export const brevo: Sender = {
  // #region brevo
  // env: BREVO_API_KEY. `fromEmail` must be a bare address here.
  // No per-message switch: turn click tracking off in Brevo.
  sendEmail: ({ to, fromEmail, subject, html, text }) =>
    s.api.request({
      url: "https://api.brevo.com/v3/smtp/email",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "your-app",
        "api-key": env("BREVO_API_KEY"),
      },
      params: obj({
        sender: obj({ email: fromEmail, name: c.text("Your App") }),
        to: [obj({ email: to })],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    }),
  // #endregion brevo
};

export const loops: Sender = {
  // #region loops
  // env: LOOPS_API_KEY. The template lives in Loops, so only the link is sent.
  // No per-message switch: turn click tracking off in Loops.
  sendEmail: ({ to, resetLink }) =>
    s.api.request({
      url: "https://app.loops.so/api/v1/transactional",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "your-app",
        Authorization: withFilters(c.text("Bearer "), fl.concat(env("LOOPS_API_KEY"))),
      },
      params: obj({
        transactionalId: c.text("your-transactional-id"),
        email: to,
        dataVariables: obj({ resetLink }),
      }),
    }),
  // #endregion loops
};

export const ses: Sender = {
  // #region ses
  // env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. Both steps run, in order.
  // Set your SES region in BOTH places it appears.
  // Attach no configuration set that tracks clicks.
  sendEmail: ({ to, fromEmail, subject, html, text }) => [
    s.set_var("ses_mail", obj({ to, from: fromEmail, subject, html, text })),
    s.lambda({
      as: "ses_status",
      timeout: c.int(15),
      code: async ({ $var, $env }) => {
        const body = JSON.stringify({
          FromEmailAddress: $var.ses_mail.from,
          Destination: { ToAddresses: [$var.ses_mail.to] },
          Content: {
            Simple: {
              Subject: { Data: $var.ses_mail.subject },
              Body: { Html: { Data: $var.ses_mail.html }, Text: { Data: $var.ses_mail.text } },
            },
          },
        });
        const host = "email.us-east-1.amazonaws.com";
        const path = "/v2/email/outbound-emails";
        const signed = aws4.sign(
          { service: "ses", region: "us-east-1", host, path, method: "POST", headers: { "Content-Type": "application/json" }, body },
          { accessKeyId: $env.AWS_ACCESS_KEY_ID, secretAccessKey: $env.AWS_SECRET_ACCESS_KEY },
        );
        const res = await fetch(`https://${host}${path}`, { method: "POST", headers: signed.headers, body });
        return res.status;
      },
    }),
  ],
  // #endregion ses
};

/** Stands in for the function a migrated app already sends its mail with. */
export const sendAppEmail = defineFunction({
  name: "send_app_email",
  input: {
    to: input.email({ required: true }),
    subject: input.text({ required: true }),
    html: input.text({ required: true }),
  },
  stack: [s.set_var("seen", inp("to"))],
  response: { ok: c.bool(true) },
});

export const existingFunction: Sender = {
  // #region function
  // The function your app already sends mail with. Register it as usual, give it
  // `history: false`, and turn click tracking off wherever it sends through.
  sendEmail: ({ to, subject, html }) =>
    s.function.run({ fn: sendAppEmail, input: { to, subject, html }, as: "mailed" }),
  // #endregion function
};

/** Every recipe, by the region name it is published under. */
export const senders = { sendgrid, postmark, mailgun, brevo, loops, ses, function: existingFunction };
