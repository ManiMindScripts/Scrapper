/**
 * Fast Deterministic Company Website Extractor (100% Free / No API Calls)
 * Extracts canonical corporate website URLs from ATS links, custom subdomains, and corporate pages.
 */

const COMMON_AGGREGATOR_DOMAINS = new Set([
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "google.com",
  "getro.com",
  "climatebase.org",
  "inclimate.com",
  "foodimpactcareers.com",
  "climatetechlist.com",
  "consider.com",
  "workinbiotech.com",
  "monster.com",
  "simplyhired.com",
  "careerbuilder.com",
  "wellfound.com",
  "angel.co",
  "ycombinator.com",
]);

export function extractCompanyUrl(
  applyUrl?: string | null | undefined,
  companyName?: string | null | undefined,
): string {
  if (!applyUrl && !companyName) return "";

  const urlStr = (applyUrl || "").trim();

  if (urlStr) {
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();

      // 1. Direct ATS Platforms
      // Lever: jobs.lever.co/<company>
      if (host.includes("lever.co")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }

      // Greenhouse: boards.greenhouse.io/<company> or greenhouse.io/<company>
      if (host.includes("greenhouse.io")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        const slug = parts[0] === "embed" ? parts[1] : parts[0];
        if (slug) return `https://www.${slug.replace(/inc|corp|llc/gi, "")}.com`;
      }

      // Ashby: jobs.ashbyhq.com/<company>
      if (host.includes("ashbyhq.com")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }

      // Pinpoint: <company>.pinpointhq.com
      if (host.includes("pinpointhq.com")) {
        const sub = host.replace(".pinpointhq.com", "");
        return `https://www.${sub}.com`;
      }

      // Workable: apply.workable.com/<company>
      if (host.includes("workable.com")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }

      // Recruitee: <company>.recruitee.com
      if (host.includes("recruitee.com")) {
        const sub = host.replace(".recruitee.com", "");
        return `https://www.${sub}.com`;
      }

      // BambooHR: <company>.bamboohr.com
      if (host.includes("bamboohr.com")) {
        const sub = host.replace(".bamboohr.com", "");
        return `https://www.${sub}.com`;
      }

      // SmartRecruiters: jobs.smartrecruiters.com/<company>
      if (host.includes("smartrecruiters.com")) {
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }

      // Rippling: <company>.rippling-ats.com
      if (host.includes("rippling-ats.com")) {
        const sub = host.replace(".rippling-ats.com", "");
        return `https://www.${sub}.com`;
      }

      // 2. Direct corporate domain or career subdomain (not an aggregator)
      const isAggregator = Array.from(COMMON_AGGREGATOR_DOMAINS).some((agg) =>
        host.includes(agg),
      );

      if (!isAggregator && host.includes(".")) {
        // Strip career subdomains (e.g. careers.enphase.com -> enphase.com)
        const cleanHost = host.replace(
          /^(careers|jobs|job-boards|talent|apply|work|join|hire|app)\./i,
          "",
        );
        const formattedHost = cleanHost.startsWith("www.")
          ? cleanHost
          : cleanHost.split(".").length === 2
            ? `www.${cleanHost}`
            : cleanHost;

        return `${parsed.protocol}//${formattedHost}`;
      }
    } catch {
      // Ignore URL parse errors
    }
  }

  // 3. Clean fallback heuristic if no other source available
  if (companyName && companyName.trim()) {
    const cleanComp = companyName
      .toLowerCase()
      .trim()
      .replace(/^(the|a)\s+/i, "")
      .replace(/[\.,\(\)\-\_]/g, "")
      .replace(/\s+(inc|llc|ltd|corp|corporation|gmbh|co|holdings|group)$/i, "")
      .replace(/\s+/g, "")
      .trim();

    if (cleanComp && cleanComp.length > 2) {
      return `https://www.${cleanComp}.com`;
    }
  }

  return "";
}
