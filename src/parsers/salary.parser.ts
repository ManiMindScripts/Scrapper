export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
}

/**
 * Parses raw salary string into structured min, max, and currency values.
 * Phase 2 provides foundational parsing; Phase 3 expands edge-case compensation strings.
 */
export function parseSalary(raw: string | undefined | null): ParsedSalary {
  const result: ParsedSalary = {
    min: null,
    max: null,
    currency: null,
  };

  if (!raw) {
    return result;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return result;
  }

  // Detect currency symbol or code
  if (trimmed.includes("$") || /USD/i.test(trimmed)) {
    result.currency = "USD";
  } else if (trimmed.includes("€") || /EUR/i.test(trimmed)) {
    result.currency = "EUR";
  } else if (trimmed.includes("£") || /GBP/i.test(trimmed)) {
    result.currency = "GBP";
  } else if (/CAD/i.test(trimmed)) {
    result.currency = "CAD";
  }

  const currencyPrefix = "(?:[$€£]|CAD|USD|EUR|GBP)?";

  // Match patterns like "$120,000 - $160,000", "120k - 160k", "120000 - 160000"
  const rangeRegex = new RegExp(
    `${currencyPrefix}\\s*([\\d,.]+)\\s*(k|m)?\\s*(?:[-–—]|\\bto\\b)\\s*${currencyPrefix}\\s*([\\d,.]+)\\s*(k|m)?`,
    "i",
  );

  const rangeMatch = trimmed.match(rangeRegex);
  if (rangeMatch) {
    const minValStr = rangeMatch[1]?.replace(/,/g, "");
    const minMultiplier = rangeMatch[2]?.toLowerCase();
    const maxValStr = rangeMatch[3]?.replace(/,/g, "");
    const maxMultiplier = (rangeMatch[4] || rangeMatch[2])?.toLowerCase();

    if (minValStr && maxValStr) {
      let min = parseFloat(minValStr);
      let max = parseFloat(maxValStr);

      if (minMultiplier === "k") min *= 1000;
      if (minMultiplier === "m") min *= 1000000;
      if (maxMultiplier === "k") max *= 1000;
      if (maxMultiplier === "m") max *= 1000000;

      if (!isNaN(min)) result.min = Math.round(min);
      if (!isNaN(max)) result.max = Math.round(max);
      return result;
    }
  }

  // Match single value like "$150,000" or "150k"
  const singleRegex = new RegExp(
    `${currencyPrefix}\\s*([\\d,.]+)\\s*(k|m)?`,
    "i",
  );
  const singleMatch = trimmed.match(singleRegex);
  if (singleMatch) {
    const valStr = singleMatch[1]?.replace(/,/g, "");
    const multiplier = singleMatch[2]?.toLowerCase();
    if (valStr) {
      let val = parseFloat(valStr);
      if (multiplier === "k") val *= 1000;
      if (multiplier === "m") val *= 1000000;
      if (!isNaN(val)) {
        result.min = Math.round(val);
        result.max = Math.round(val);
      }
    }
  }

  return result;
}
