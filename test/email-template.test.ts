/**
 * The email document itself.
 *
 * Two things are worth asserting here that no other suite can see: that every
 * interpolated config value is escaped into the HTML, and that the token
 * appears in exactly the places the reader needs it - the button's `href` and
 * a URL they can copy.
 *
 * The parts are asserted JOINED, because the split is an implementation detail
 * of the filter chain. What must be true is a property of the assembled
 * document, and a test written against the split would pass while the join
 * produced nonsense - which is exactly the bug it is here to catch.
 */
import { describe, it, expect } from "vitest";
import { env } from "@xano/sdk";
import { resolveOptions } from "../src/options.js";
import { escapeHtml, htmlBody, textBody, messageParts } from "../src/api/email-template.js";
import type { MessageParts, MessageSlot } from "../src/api/email-template.js";
import { baseOptions } from "./helpers.js";

const TOKEN = "TOK3N";
const assemble = (parts: string[]) => parts.join(TOKEN);
const html = (overrides = {}) => assemble(htmlBody(resolveOptions({ ...baseOptions, ...overrides })).parts);

describe("escapeHtml", () => {
  it("escapes every character that can break a document or an attribute", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("escapes the ampersand FIRST, so an escape is not re-escaped", () => {
    // `<` -> `&lt;` -> `&amp;lt;` is the classic ordering bug, and it renders
    // as literal "&lt;" rather than "<".
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("the HTML document", () => {
  it("puts the token in the button href AND in a copyable URL", () => {
    const doc = html();
    const hrefs = [...doc.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    // A single-button email is unusable for anyone whose client strips links,
    // and "click the button" with no visible URL is the shape people are
    // taught not to trust.
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) expect(href).toBe(`https://app.example.com/reset?token=${TOKEN}`);
    // And the fallback anchor's visible TEXT is the whole URL, token included.
    // Without this the reader is shown a link ending `?token=` with nothing
    // after it - copyable, and useless.
    expect(doc).toContain(`>https://app.example.com/reset?token=${TOKEN}</a>`);
    // Three joins in all: two hrefs and the visible text.
    expect(doc.split(TOKEN)).toHaveLength(4);
  });

  it("joins with & when the consumer's URL already has a query string", () => {
    const doc = html({ resetUrl: "https://app.example.com/reset?lang=en" });
    expect(doc).toContain(`href="https://app.example.com/reset?lang=en&amp;token=${TOKEN}"`);
  });

  it("escapes every interpolated config value", () => {
    const doc = html({
      brandName: "Ben & Jerry's",
      emailSubject: "Reset <your> password",
      emailIntro: 'He said "hi" & left',
      emailOutro: "5 > 3",
      emailButtonLabel: "Go & do it",
    });
    expect(doc).toContain("Ben &amp; Jerry&#39;s");
    expect(doc).toContain("Reset &lt;your&gt; password");
    expect(doc).toContain("He said &quot;hi&quot; &amp; left");
    expect(doc).toContain("5 &gt; 3");
    expect(doc).toContain("Go &amp; do it");
    // Nothing a consumer typed may reach the document as markup.
    expect(doc).not.toContain("<your>");
  });

  it("is a complete document, not a fragment", () => {
    const doc = html();
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("lays out with tables and inline styles, for Outlook", () => {
    const doc = html();
    // Outlook renders through Word's HTML engine: no flex, no grid, and no
    // reliable <style> block. A div layout collapses there while looking fine
    // everywhere the author tested.
    expect(doc).toContain('role="presentation"');
    expect(doc).not.toContain("display:flex");
    expect(doc).not.toContain("display:grid");
  });

  it("carries a preheader, so the client does not invent one", () => {
    const doc = html({ emailSubject: "Reset your password" });
    // Left unset, a client pulls the first text in the document.
    expect(doc).toContain("max-height:0");
    expect(doc).toContain("Reset your password");
  });

  it("defines its dark palette only as an override on the light one", () => {
    const doc = html();
    expect(doc).toContain("prefers-color-scheme: dark");
    // The inline light styles must stand alone: the media block is a
    // progressive enhancement, and plenty of clients strip <style> entirely.
    expect(doc).toContain("background:#ffffff");
  });

  it("omits the brand block entirely when there is no brandName", () => {
    expect(html()).not.toContain("text-transform:uppercase");
    expect(html({ brandName: "Acme" })).toContain("Acme");
  });
});

describe("the plain-text body", () => {
  it("has one token join and no markup", () => {
    const parts = textBody(resolveOptions({ ...baseOptions, emailFormat: "text" })).parts;
    expect(parts).toHaveLength(2);
    const doc = assemble(parts);
    expect(doc).not.toContain("<");
    expect(doc).toContain(`https://app.example.com/reset?token=${TOKEN}`);
  });

  it("does NOT html-escape, because there is no document to break", () => {
    const doc = assemble(
      textBody(resolveOptions({ ...baseOptions, emailFormat: "text", emailIntro: "5 > 3 & fine" })).parts,
    );
    expect(doc).toContain("5 > 3 & fine");
  });
});

describe("messageParts", () => {
  it("follows the configured format", () => {
    expect(messageParts(resolveOptions({ ...baseOptions })).parts).toHaveLength(4);
    expect(messageParts(resolveOptions({ ...baseOptions, emailFormat: "text" })).parts).toHaveLength(2);
  });
});

describe("a resetUrl resolved at REQUEST time", () => {
  /**
   * `resetUrl` is otherwise baked into the document at export. That is fine
   * wherever the frontend URL is stable and wrong on an ephemeral, where
   * `deploy --static` mints a new host on every run and a deploy WITHOUT
   * `--static` deletes the one that is serving - so the link can only ever
   * carry the previous deploy's URL (dev-log 2026-08-31, xanots/sdk#240).
   *
   * Passing `env("APP_URL")` moves the URL to a slot the stack fills when the
   * mail is sent, so a deploy can set it after it knows its own host.
   */
  const runtime = (overrides = {}) =>
    resolveOptions({ ...baseOptions, resetUrl: env("APP_URL"), ...overrides });

  const fill = (parts: MessageParts, values: Record<MessageSlot, string>) =>
    parts.parts.reduce(
      (doc, part, i) => doc + part + (i < parts.slots.length ? values[parts.slots[i]!] : ""),
      "",
    );

  it("splits the text body at the URL and joins both slots in order", () => {
    const parts = textBody(runtime({ emailFormat: "text" }));
    expect(parts.slots).toEqual(["url", "token"]);
    expect(fill(parts, { url: "https://live.example.com/reset", token: TOKEN })).toContain(
      `https://live.example.com/reset?token=${TOKEN}`,
    );
  });

  it("fills all THREE link sites in the HTML document", () => {
    // The button href, the fallback anchor's href, and that anchor's visible
    // text. Missing the third produces a copyable link that stops at `?token=`.
    const parts = htmlBody(runtime());
    expect(parts.slots).toEqual(["url", "token", "url", "token", "url", "token"]);
    const doc = fill(parts, { url: "https://live.example.com/reset", token: TOKEN });
    const hrefs = [...doc.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      `https://live.example.com/reset?token=${TOKEN}`,
      `https://live.example.com/reset?token=${TOKEN}`,
    ]);
    expect(doc).toContain(`>https://live.example.com/reset?token=${TOKEN}</a>`);
  });

  it("always uses `?token=`, never `&token=`", () => {
    // The separator depends on whether the URL already carries a query string,
    // which a build-time compiler cannot read. The option documents "no query
    // string" as the contract for this form.
    const parts = textBody(runtime({ emailFormat: "text" }));
    expect(parts.parts.join("|")).toContain("?token=");
    expect(parts.parts.join("|")).not.toContain("&token=");
  });

  it("leaves a STRING resetUrl folded into one literal — no extra join", () => {
    // The byte-for-byte guarantee for every existing consumer: a literal URL
    // merges into the surrounding markup and produces no extra concat filter.
    // `bundle.test.ts` is the other half of this.
    expect(textBody(resolveOptions({ ...baseOptions, emailFormat: "text" })).slots).toEqual(["token"]);
    expect(htmlBody(resolveOptions({ ...baseOptions })).slots).toEqual(["token", "token", "token"]);
  });

  it("keeps `parts.length === slots.length + 1` in every shape", () => {
    for (const parts of [
      textBody(resolveOptions({ ...baseOptions, emailFormat: "text" })),
      htmlBody(resolveOptions({ ...baseOptions })),
      textBody(runtime({ emailFormat: "text" })),
      htmlBody(runtime()),
    ]) {
      expect(parts.parts).toHaveLength(parts.slots.length + 1);
    }
  });
});
