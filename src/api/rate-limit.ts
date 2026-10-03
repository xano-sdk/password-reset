/**
 * The limiter every public endpoint in this module carries.
 *
 * Returns ONE `Statement`, never a `Statement[]`: a helper returning an array
 * and spread into a query's `stack` collapses the tuple, and every `ref()` in
 * that stack - including ones declared after the spread - resolves to
 * `unknown`. Nothing in THIS repo fails when that happens; the consumer's
 * typecheck does.
 *
 * The default key part is `sys.remoteIp()`, not `auth("id")`. Every endpoint
 * here is unauthenticated, so `auth("id")` is null on all of them and one
 * bucket would be shared by every caller on the internet - a limiter that reads
 * correct and rate-limits the whole world together.
 *
 * The `action` prefix is load-bearing: co-attaching one key to N endpoints
 * means all N share ONE counter, so `max: 5` would be a budget across the three
 * of them rather than five each.
 */
import { s, c, sys, withFilters, fl, type Statement, type Value } from "@xano/sdk";
import type { RateLimitOptions } from "../options.js";

export const rateLimitStatement = (
  action: string,
  limit: RateLimitOptions | false,
  keyPart: Value = sys.remoteIp(),
): Statement =>
  s.redis.ratelimit({
    key: withFilters(c.text(`pwreset:${action}:`), fl.concat(keyPart)),
    max: c.int(limit === false ? 1 : limit.max),
    ttl: c.int(limit === false ? 1 : limit.ttl),
    error: c.text("Too many password reset attempts. Wait a few minutes and try again."),
    // `rateLimit: false` keeps the step in the stack and turns it OFF, rather
    // than removing it. Two reasons: the stack stays one literal tuple in both
    // configurations (a conditional spread would widen it), and the disabled
    // step is visible in the Xano UI, so someone reading the deployed endpoint
    // can see the limiter exists and was opted out of.
    ...(limit === false ? { disabled: true } : {}),
  });
