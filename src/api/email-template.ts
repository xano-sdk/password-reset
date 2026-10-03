/**
 * The reset email's body, as literal parts joined around the token.
 *
 * The token is the ONLY runtime value in the message. Everything else is a
 * build-time constant, so the document is assembled here, in TypeScript, and
 * the stack only has to concatenate: `part[0] + token + part[1] + token + …`.
 * That matters because a JS template literal cannot compose a tagged value - it
 * stringifies it at build time and mails `[object Object]` - so the split is
 * not a style choice, it is the only correct shape.
 *
 * The token appears TWICE on purpose: once in the button's `href`, and once as
 * text a reader can copy. A single-button email is unusable for anyone whose
 * client strips links, and "click the button" with no visible URL is exactly
 * the shape people are taught not to trust.
 */
import { c, ref, fl, withFilters, type Value } from "@xano/sdk";
import type { ResolvedPasswordResetOptions } from "../options.js";

/**
 * HTML-escape a build-time string.
 *
 * These values come from the consumer's own config, not from a request, so this
 * is not an XSS boundary - it is a CORRECTNESS one: a brand name containing
 * `&` or `<` would otherwise break the document. Applied to every interpolated
 * value regardless, because "this input is trusted" is the assumption that
 * stops being true after a refactor.
 *
 * The TOKEN is not escaped here and does not need to be: it is minted by
 * `s.security.create_uuid`, whose output is hex digits and dashes - no HTML
 * metacharacter can appear in it - and it is joined at runtime, where a
 * build-time escape could not reach it anyway.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * `<resetUrl>?token=` - or `&token=` when the consumer's URL already carries a
 * query string. Built from an option already validated as an http(s) URL.
 *
 * Build-time only. A runtime `resetUrl` (an `env()` value) cannot be inspected
 * here, so it always takes `?token=` - see {@link linkSegments}.
 */
export const linkPrefix = (resetUrl: string): string =>
  `${resetUrl}${resetUrl.includes("?") ? "&" : "?"}token=`;

/** What the stack joins between two literal parts: the token, or the reset URL. */
export type MessageSlot = "token" | "url";

/**
 * One piece of the document: a literal string, or a slot filled at RUNTIME.
 *
 * The token has always been a runtime slot. `resetUrl` becomes one too when the
 * consumer passes a `Value` (`env("APP_URL")`) instead of a string, which is
 * what lets a deploy set the frontend URL after it knows the host.
 */
export type MessageSegment = string | { slot: MessageSlot };

const TOKEN_SLOT: MessageSegment = { slot: "token" };
const URL_SLOT: MessageSegment = { slot: "url" };

/**
 * The link prefix, as segments: one folded literal when `resetUrl` is a string,
 * or the runtime slot followed by the separator when it is a `Value`.
 *
 * `?token=` and never `&token=` in the runtime case - the separator depends on
 * whether the URL already carries a query string, and a value resolved at
 * request time cannot be read at build time. The option's docs make "no query
 * string" the contract for the `env()` form.
 *
 * `escape` is applied by the CALLER (html only) to the literal form, because a
 * runtime value cannot be escaped here at all.
 */
const linkSegments = (options: ResolvedPasswordResetOptions): MessageSegment[] =>
  typeof options.resetUrl === "string"
    ? [linkPrefix(options.resetUrl)]
    : [URL_SLOT, "?token="];

/**
 * The literal parts of the message, in order, with `slots[i]` joined between
 * `parts[i]` and `parts[i + 1]`. `parts.length` is always `slots.length + 1`.
 */
export interface MessageParts {
  parts: string[];
  slots: MessageSlot[];
}

/**
 * Collapse a segment list into parts and slots, folding adjacent literals.
 *
 * The folding is what keeps a string `resetUrl` byte-identical to what this
 * module has always emitted: its link prefix is a literal, so it merges into
 * the surrounding text and no extra concat filter is produced. Only a runtime
 * URL splits a part.
 */
export function foldSegments(segments: MessageSegment[]): MessageParts {
  const parts: string[] = [];
  const slots: MessageSlot[] = [];
  let literal = "";
  for (const segment of segments) {
    if (typeof segment === "string") {
      literal += segment;
      continue;
    }
    parts.push(literal);
    slots.push(segment.slot);
    literal = "";
  }
  parts.push(literal);
  return { parts, slots };
}

/** The plain-text body. One token, so two parts (three when the URL is runtime). */
export function textBody(options: ResolvedPasswordResetOptions): MessageParts {
  return foldSegments([
    `${options.emailIntro}\n\n`,
    ...linkSegments(options),
    TOKEN_SLOT,
    `\n\n${options.emailOutro}`,
  ]);
}

/**
 * The HTML body. Two tokens - the button href and the copyable URL - so three
 * parts.
 *
 * Written as a table, with every style inline. That is not nostalgia: Outlook
 * renders through Word's HTML engine, which has no `flex`, no `grid` and no
 * `<style>` block worth relying on, and a `<div>` layout collapses there while
 * looking fine everywhere the author tested. The one `<style>` block carries
 * only the dark-mode overrides, which are a progressive enhancement - the inline
 * light styles stand on their own if it is stripped.
 */
export function htmlBody(options: ResolvedPasswordResetOptions): MessageParts {
  const intro = escapeHtml(options.emailIntro);
  const outro = escapeHtml(options.emailOutro);
  const button = escapeHtml(options.emailButtonLabel);
  const brand = options.brandName === undefined ? null : escapeHtml(options.brandName);
  const accent = escapeHtml(options.brandColor);
  // The link, as segments. A string `resetUrl` folds into the surrounding markup
  // exactly as it always has, escaped for correctness; a runtime one is a slot,
  // and CANNOT be escaped here - see the trust note on `PasswordResetOptions.resetUrl`.
  const href: MessageSegment[] =
    typeof options.resetUrl === "string"
      ? [escapeHtml(linkPrefix(options.resetUrl))]
      : linkSegments(options);

  // The preheader is the grey line a client shows beside the subject. Left
  // unset, clients pull the first text in the document - which here would be
  // the brand name or a stray nbsp - so it is set deliberately.
  const preheader = escapeHtml(options.emailSubject);

  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${preheader}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .pw-bg { background: #09090b !important; }
    .pw-card { background: #18181b !important; border-color: #27272a !important; }
    .pw-head, .pw-url { color: #fafafa !important; }
    .pw-body, .pw-foot { color: #a1a1aa !important; }
    .pw-rule { border-color: #27272a !important; }
  }
  @media (max-width: 480px) {
    .pw-card { padding: 28px 22px !important; }
  }
</style>
</head>
<body class="pw-bg" style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;font-size:1px;color:#f4f4f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="pw-bg" style="background:#f4f4f5;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;">
<tr><td class="pw-card" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:14px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
${
  brand === null
    ? ""
    : `<p style="margin:0 0 22px;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${accent};">${brand}</p>`
}<h1 class="pw-head" style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:650;color:#18181b;">${escapeHtml(options.emailSubject)}</h1>
<p class="pw-body" style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#52525b;">${intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:9px;background:${accent};">
<a href="`;

  const afterHref = `" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:9px;">${button}</a>
</td></tr></table>
<p class="pw-body" style="margin:26px 0 6px;font-size:13px;line-height:1.6;color:#71717a;">Or paste this link into your browser:</p>
<p class="pw-url" style="margin:0;font-size:13px;line-height:1.6;word-break:break-all;"><a href="`;

  // Ends WITHOUT closing the anchor: the token is joined next, so the URL the
  // reader sees is the whole URL. Ending the text at the link prefix would print
  // a link that stops at `?token=` - copyable, and useless.
  const tail = `" style="color:${accent};text-decoration:underline;">`;

  const foot = `</a></p>
<hr class="pw-rule" style="border:none;border-top:1px solid #e4e4e7;margin:28px 0 0;">
<p class="pw-foot" style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#71717a;">${outro}</p>
</td></tr></table>
</td></tr></table>
</body>
</html>`;

  // THREE tokens: the button's href, the fallback anchor's href, and that
  // anchor's visible text. The third is easy to forget and produces a link that
  // reads `…?token=` with nothing after it. The link prefix appears before each
  // of them, which is why `href` is spread three times.
  return foldSegments([
    head,
    ...href,
    TOKEN_SLOT,
    afterHref,
    ...href,
    TOKEN_SLOT,
    tail,
    ...href,
    TOKEN_SLOT,
    foot,
  ]);
}

/** The body for the configured format. */
export const messageParts = (options: ResolvedPasswordResetOptions): MessageParts =>
  options.emailFormat === "html" ? htmlBody(options) : textBody(options);

/**
 * The `message` value: the literal parts joined with the token between them, at
 * RUNTIME, through the filter chain.
 *
 * The chain is built from an array, which is safe here in a way it would not be
 * in a query's `stack`: this produces one `Value`, and the tuple rule is about
 * the statement list. Nothing about the response type passes through it.
 */
export function messageValue(options: ResolvedPasswordResetOptions, tokenVar: string): Value {
  const { parts, slots } = messageParts(options);
  const [first, ...rest] = parts;
  // A slot is the token, or - only when `resetUrl` was passed as a Value - the
  // reset URL itself, resolved at request time. `withFilters` on the caller's
  // value keeps whatever filters they attached to it.
  const fill = (slot: MessageSlot): Value =>
    slot === "token" ? ref(tokenVar) : (options.resetUrl as Value);
  const filters = rest.flatMap((part, index) => [
    fl.concat(fill(slots[index] as MessageSlot)),
    fl.concat(c.text(part)),
  ]);
  return withFilters(c.text(first ?? ""), ...filters);
}
