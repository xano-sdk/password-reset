/**
 * The last step of a reset request: hand the message to a mailer.
 *
 * Two routes. Without `sendEmail`, one `s.util.send_email` through Resend or
 * the built-in mailer. With it, the message is bound to stack variables and the
 * consumer's own statements send it through whatever provider they already use.
 *
 * Either way this runs inside `post_process`, inside the "there is an account"
 * conditional. A sender therefore cannot reach the response, in its body, its
 * status or its timing, and swapping the provider cannot reopen the account
 * enumeration oracle the rest of the endpoint is built to close.
 */
import { s, c, ref, env, type Statement, type Value } from "@xano/sdk";
import { fail, type ResetEmail, type ResolvedPasswordResetOptions } from "../options.js";
import { htmlBody, joinParts, linkParts, messageParts, textBody } from "./email-template.js";

/** The variables a custom sender's message is bound to. */
const LINK_VAR = "reset_link";
const HTML_VAR = "reset_html";
const TEXT_VAR = "reset_text";

/** Every variable the message is read from. A sender that rebinds one changes the email. */
const RESERVED_VARS = ["user", "token", LINK_VAR, HTML_VAR, TEXT_VAR];

/** Read back from the row, never echoed from the input: the address the account actually has. */
const recipient = (options: ResolvedPasswordResetOptions): Value => ref(`user.${options.emailColumn}`);

/** Resend, or the built-in mailer. */
const builtInSend = (options: ResolvedPasswordResetOptions): Statement =>
  s.util.send_email({
    to: recipient(options),
    ...(options.fromEmail === undefined ? {} : { from: c.text(options.fromEmail) }),
    subject: c.text(options.emailSubject),
    // A JS template literal CANNOT compose a tagged value - it
    // stringifies it at build time and mails "[object Object]". The
    // document's literal halves are assembled at build time in
    // email-template.ts; the token is joined at RUNTIME, by the filter
    // chain, once per place it appears.
    message: joinParts(options, messageParts(options), "token"),
    service_provider: options.emailProvider,
    // The key is read server-side out of the workspace environment. It
    // is never in the bundle, so it cannot reach a frontend build.
    ...(options.emailProvider === "resend" ? { api_key: env(options.apiKeyEnv) } : {}),
    as: "sent",
  });

/**
 * What the consumer's sender is handed.
 *
 * The link and both bodies arrive as bare `ref()`s rather than as the filter
 * chains that compose them. A filtered value cannot be an argument inside
 * `obj()`, and a runtime `resetUrl` may carry filters of its own, so a chain
 * here would compose in some slots of a request and throw in others. A `ref()`
 * composes in all of them.
 */
const resetEmail = (options: ResolvedPasswordResetOptions): ResetEmail => {
  const email: Omit<ResetEmail, "fromEmail"> = {
    to: recipient(options),
    subject: c.text(options.emailSubject),
    html: ref(HTML_VAR),
    text: ref(TEXT_VAR),
    resetLink: ref(LINK_VAR),
    token: ref("token"),
  };
  if (options.fromEmail !== undefined) return { ...email, fromEmail: c.text(options.fromEmail) };
  // A throwing getter, because whether this is required is the SENDER's answer:
  // a provider that takes the sender from a template never reads it, and one
  // that does must not be handed an empty address to fail with at send time.
  // Not enumerable, so only a read that NAMES it throws - a spread does not.
  return Object.defineProperty(email, "fromEmail", {
    enumerable: false,
    get: () =>
      fail(
        "`sendEmail` reads `fromEmail`, but the `fromEmail` option was not passed. Pass the address " +
          "your provider has verified, or write the sender inside `sendEmail` and do not read it.",
      ),
  }) as ResetEmail;
};

const isStatement = (value: unknown): value is Statement =>
  typeof value === "object" && value !== null && typeof (value as { name?: unknown }).name === "string";

/**
 * The reserved variables these statements bind or update, nested blocks included.
 *
 * Walked structurally: a binding is an `as`, wherever in a statement it sits,
 * and `update_var` names its target in `context`.
 */
const reboundVars = (node: unknown, found = new Set<string>(), seen = new Set<object>()): Set<string> => {
  if (typeof node !== "object" || node === null || seen.has(node)) return found;
  seen.add(node);
  const { as, name, context } = node as { as?: unknown; name?: unknown; context?: { name?: unknown } | null };
  const targets = name === "mvp:update_var" ? [as, context?.name] : [as];
  for (const target of targets) {
    if (typeof target !== "string") continue;
    // `update_var` takes a path: `user.email` rebinds part of `user`.
    const root = target.split(".")[0] as string;
    if (RESERVED_VARS.includes(root)) found.add(root);
  }
  for (const child of Object.values(node)) reboundVars(child, found, seen);
  return found;
};

/**
 * The consumer's statements, checked.
 *
 * Checked here and not in `resolveOptions` because the function has to be
 * CALLED to be checked. An empty result is refused by name: it encodes cleanly,
 * answers 200, and sends nothing to anyone, which is the one failure a reset
 * flow cannot surface at runtime.
 */
const customSend = (
  options: ResolvedPasswordResetOptions,
  sendEmail: NonNullable<ResolvedPasswordResetOptions["sendEmail"]>,
): Statement[] => {
  const returned: unknown = sendEmail(resetEmail(options));
  const steps: unknown[] = Array.isArray(returned) ? returned : [returned];
  if (steps.length === 0) {
    fail("`sendEmail` returned no statements, so no reset email would ever be sent. Return at least one.");
  }
  if (!steps.every(isStatement)) {
    fail(
      "`sendEmail` must return a statement, or an array of them, such as `s.api.request({ … })` or " +
        "`s.function.run({ … })`. It runs once, while the workspace is built, so it cannot be async, and " +
        "an arrow function with braces needs a `return`.",
    );
  }
  // `as: "user"` and `as: "token"` are the likeliest names a sender would pick,
  // and either one silently redirects or blanks the email after it: the message
  // is read from these variables when the send runs, after the response.
  const rebound = [...reboundVars(steps)];
  if (rebound.length > 0) {
    fail(
      `\`sendEmail\` binds ${rebound.map((name) => `\`${name}\``).join(" and ")}, which the reset email is read ` +
        `from, so the mail could go out wrong or to the wrong address. Use another \`as\` name. Taken: ` +
        `${RESERVED_VARS.join(", ")}.`,
    );
  }
  return steps as Statement[];
};

/**
 * The statements that send the message.
 *
 * A `Statement[]`, which is safe ONLY because it is spread into a conditional's
 * `then`. The query's own `stack` must stay a literal tuple, so never spread
 * this there.
 */
export const sendEmailStatements = (options: ResolvedPasswordResetOptions): Statement[] => {
  if (options.sendEmail === undefined) return [builtInSend(options)];
  return [
    s.set_var(LINK_VAR, joinParts(options, linkParts(options), "token")),
    s.set_var(HTML_VAR, joinParts(options, htmlBody(options), "token")),
    s.set_var(TEXT_VAR, joinParts(options, textBody(options), "token")),
    ...customSend(options, options.sendEmail),
  ];
};
