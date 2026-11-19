/** A rejected prompt cannot become valid through another login or more retries. */
export function retryDecision(
  attempt: number,
  message: string,
  options: { readonly usageLimit?: boolean } = {},
): "retry" | "invalid-input" | "usage-limit" | "exhausted" {
  if (
    /ERR_INPUT_LIMIT|context[_ ]length|maximum context|too many (?:input )?tokens|input (?:is )?too (?:large|long)/i.test(
      message,
    )
  )
    return "invalid-input";
  // A spent quota or rate-limit window cannot refill within a retry delay, so another
  // request would only spend an attempt and repeat the same rejection.
  if (options.usageLimit === true) return "usage-limit";
  return attempt > 3 ? "exhausted" : "retry";
}
