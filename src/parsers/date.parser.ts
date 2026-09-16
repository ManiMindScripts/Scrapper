/**
 * Parses raw date or relative timestamp string into an ISO 8601 string or null.
 * Handles relative Getro dates ("3 days ago", "just now", "yesterday", "a week ago", "3w ago", etc.)
 * as well as absolute ISO / date strings.
 */
export function parsePostedDate(
  raw: string | undefined | null,
  referenceDate: Date = new Date(),
): string | null {
  if (!raw) {
    return null;
  }

  let cleaned = raw.trim();
  if (!cleaned) {
    return null;
  }

  // Strip prefixes like "Posted ", "• ", etc.
  cleaned = cleaned.replace(/^posted\s+/i, "").replace(/^[•·\-\s]+/, "").trim();

  // Try direct Date parsing for absolute ISO or standard date formats
  // Only use Date constructor if it doesn't look like pure relative text or simple numbers
  if (!/ago|yesterday|today|now/i.test(cleaned)) {
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
      return parsed.toISOString();
    }
  }

  const lower = cleaned.toLowerCase();

  if (lower === "just now" || lower === "today") {
    return referenceDate.toISOString();
  }

  if (lower === "yesterday") {
    const d = new Date(referenceDate.getTime());
    d.setDate(d.getDate() - 1);
    return d.toISOString();
  }

  // Handle "a day ago", "an hour ago", "a week ago", "a month ago", "a year ago"
  const singleUnitMatch = lower.match(/^an?\s+(minute|hour|day|week|month|year)\s+ago$/);
  if (singleUnitMatch) {
    const unit = singleUnitMatch[1]!;
    return subtractTime(referenceDate, 1, unit);
  }

  // Handle standard "X minutes/hours/days/weeks/months/years ago"
  const standardMatch = lower.match(
    /^(\d+)\s*(minute|min|hour|hr|day|week|wk|month|mo|year|yr)s?\s*ago$/,
  );
  if (standardMatch) {
    const amount = parseInt(standardMatch[1]!, 10);
    const rawUnit = standardMatch[2]!;
    const unit = normalizeTimeUnit(rawUnit);
    return subtractTime(referenceDate, amount, unit);
  }

  // Handle compact representations like "3d", "3d ago", "2w", "1mo"
  const compactMatch = lower.match(/^(\d+)\s*(m|h|d|w|mo|y)(?:\s*ago)?$/);
  if (compactMatch) {
    const amount = parseInt(compactMatch[1]!, 10);
    const symbol = compactMatch[2]!;
    const unitMap: Record<string, string> = {
      m: "minute",
      h: "hour",
      d: "day",
      w: "week",
      mo: "month",
      y: "year",
    };
    const unit = unitMap[symbol];
    if (unit) {
      return subtractTime(referenceDate, amount, unit);
    }
  }

  return null;
}

function normalizeTimeUnit(rawUnit: string): string {
  if (/^min/i.test(rawUnit)) return "minute";
  if (/^h/i.test(rawUnit)) return "hour";
  if (/^d/i.test(rawUnit)) return "day";
  if (/^w/i.test(rawUnit)) return "week";
  if (/^mo/i.test(rawUnit)) return "month";
  if (/^y/i.test(rawUnit)) return "year";
  return rawUnit;
}

function subtractTime(ref: Date, amount: number, unit: string): string {
  const target = new Date(ref.getTime());
  switch (unit) {
    case "minute":
      target.setMinutes(target.getMinutes() - amount);
      break;
    case "hour":
      target.setHours(target.getHours() - amount);
      break;
    case "day":
      target.setDate(target.getDate() - amount);
      break;
    case "week":
      target.setDate(target.getDate() - amount * 7);
      break;
    case "month":
      target.setMonth(target.getMonth() - amount);
      break;
    case "year":
      target.setFullYear(target.getFullYear() - amount);
      break;
  }
  return target.toISOString();
}
