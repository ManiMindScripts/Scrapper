import type { CeoInfo } from "../types/job.types.js";
import { Logger, defaultLogger } from "../pipeline/logger.js";

export interface SearxngClientOptions {
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  logger?: Logger | undefined;
}

const STOPWORDS = new Set([
  "about", "team", "company", "profile", "overview", "leadership", "officer", "executive",
  "board", "founder", "director", "investor", "news", "press", "article", "career",
  "jobs", "contact", "services", "solutions", "group", "holdings", "corp", "inc",
  "llc", "gmbh", "ltd", "of", "and", "the", "at", "speaks", "from", "with", "on", "by", "chez",
  "de", "in", "our", "his", "her", "their", "meet", "leading", "future", "people",
  "global", "international", "post", "view", "read", "see", "story", "interviews",
  "interview", "podcast", "energy", "water", "solar", "clean", "tech", "technologies",
  "technology", "systems", "management", "governance", "information", "council",
  "alumni", "association", "institute", "ranking", "report", "series", "profile",
  "caltech", "stanford", "forbes", "linkedin", "wikipedia", "crunchbase", "tracxn",
  "zoominfo", "craft", "dealmakers", "smart", "business", "also", "selected", "one",
  "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "january", "february", "march", "year", "years", "since", "sat", "speaking", "keynote"
]);

const EXCLUDED_COMPANY_HOSTS = new Set([
  "linkedin.com", "wikipedia.org", "crunchbase.com", "facebook.com", "twitter.com",
  "x.com", "instagram.com", "youtube.com", "glassdoor.com", "pitchbook.com", "zoominfo.com",
  "craft.co", "tracxn.com", "indeed.com", "ziprecruiter.com", "leadiq.com",
  "patsnap.com", "rocketreach.co", "cbinsights.com", "bloomberg.com", "reuters.com",
  "medium.com", "substack.com", "sec.gov", "opencorporates.com", "theorg.com",
  "clay.com", "smartbusinessdealmakers.com", "droneii.com", "simplywall.st",
  "getro.com", "climatebase.org", "inclimate.com", "climatetechlist.com",
  "searx.space", "github.com", "wikidata.org", "techstars.com", "ycombinator.com"
]);

export function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export function isValidCeoName(raw: string, companyName?: string): boolean {
  if (!raw) return false;
  const name = raw.replace(/[,\(\)\"\']/g, " ").replace(/\s+/g, " ").trim();
  const words = name.split(" ");
  if (words.length < 2 || words.length > 4) return false;

  // Cannot equal the company name
  if (companyName && name.toLowerCase() === companyName.toLowerCase().trim()) {
    return false;
  }

  for (const w of words) {
    const lower = w.toLowerCase().replace(/[\.\-']/g, "");
    if (STOPWORDS.has(lower)) return false;
    // Must look like a capitalized Name word or initial (e.g. T.J., O'Connor, Schröder, John)
    if (!/^[A-Z\p{L}][a-zA-Z\p{L}\.\-']{0,25}$/u.test(w)) return false;
  }

  return true;
}

export function getRootDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "";
  }
}

export function isExcludedCompanyHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const ex of EXCLUDED_COMPANY_HOSTS) {
    if (h.includes(ex)) return true;
  }
  return false;
}

export class SearxngClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;

  constructor(options: SearxngClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ||
      process.env.SEARXNG_URL ||
      "http://172.16.200.250:8081"
    this.timeoutMs =
      options.timeoutMs ||
      Number(process.env.SEARXNG_TIMEOUT_MS) ||
      12000;
    this.logger = options.logger || defaultLogger;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async searchCeo(
    companyName: string,
    companyUrl?: string | undefined,
  ): Promise<CeoInfo> {
    if (!companyName || !companyName.trim()) {
      return {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
        company_url: companyUrl || "",
      };
    }

    const cleanComp = companyName.trim();
    const query = `"${cleanComp}" CEO OR "Chief Executive Officer"`;
    const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}`;

    try {
      const res = await fetch(searchUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!res.ok) {
        throw new Error(
          `SearXNG returned HTTP ${res.status}: ${res.statusText}`,
        );
      }

      const html = await res.text();
      return this.parseCeoFromHtml(html, cleanComp, companyUrl);
    } catch (err) {
      this.logger.warn(
        `SearXNG CEO search failed for '${companyName}': ${err instanceof Error ? err.message : String(err)}`,
        "searxng-client",
      );
      return {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
        company_url: companyUrl || "",
      };
    }
  }

  public parseCeoFromHtml(
    html: string,
    companyName: string,
    fallbackCompanyUrl?: string | undefined,
  ): CeoInfo {
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const articleRegex =
      /<article class="result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    let match: RegExpExecArray | null;

    while ((match = articleRegex.exec(html)) !== null) {
      const block = match[1];
      if (!block) continue;
      const urlMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/i);
      const titleMatch = block.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i);
      const contentMatch = block.match(
        /<p class="content"[^>]*>([\s\S]*?)<\/p>/i,
      );

      if (urlMatch && urlMatch[1]) {
        results.push({
          url: urlMatch[1],
          title: decodeHtmlEntities(
            titleMatch ? titleMatch[1]?.replace(/<[^>]+>/g, "").trim() || "" : "",
          ),
          snippet: decodeHtmlEntities(
            contentMatch
              ? contentMatch[1]?.replace(/<[^>]+>/g, "").trim() || ""
              : "",
          ),
        });
      }
    }

    // Extract exact official company website
    let resolvedCompanyUrl = "";

    // 1. Infobox Official Website link
    const infoboxMatch = html.match(
      /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>[^<]*Official\s+website[^<]*<\/a>/i,
    );
    if (infoboxMatch && infoboxMatch[1]) {
      const root = getRootDomain(infoboxMatch[1]);
      if (root) {
        resolvedCompanyUrl = root;
      }
    }

    // 2. Organic top corporate domain matching company tokens
    const cleanComp = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!resolvedCompanyUrl) {
      for (const r of results) {
        try {
          const parsed = new URL(r.url);
          const host = parsed.hostname.toLowerCase();
          if (isExcludedCompanyHost(host)) continue;

          const hostClean = host
            .replace(/^(www|app|careers|jobs|talent)\./, "")
            .replace(/[^a-z0-9]/g, "");

          if (
            hostClean.includes(cleanComp.slice(0, 5)) ||
            cleanComp.includes(hostClean.slice(0, 5))
          ) {
            resolvedCompanyUrl = getRootDomain(r.url);
            break;
          }
        } catch {}
      }
    }

    // 3. Fallback to passed-in companyUrl if valid
    if (!resolvedCompanyUrl && fallbackCompanyUrl && fallbackCompanyUrl.trim()) {
      resolvedCompanyUrl = fallbackCompanyUrl.trim();
    }

    if (results.length === 0) {
      return {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
        company_url: resolvedCompanyUrl,
      };
    }

    const candidateScores = new Map<
      string,
      { score: number; url: string; count: number }
    >();

    const addCandidate = (
      rawName: string,
      baseScore: number,
      sourceUrl: string,
    ): void => {
      const clean = rawName.replace(/[,\(\)\"\']/g, " ").replace(/\s+/g, " ").trim();
      if (!isValidCeoName(clean, companyName)) return;

      const existing = candidateScores.get(clean) || {
        score: 0,
        url: sourceUrl,
        count: 0,
      };
      existing.score += baseScore;
      existing.count += 1;
      if (!existing.url) existing.url = sourceUrl;
      candidateScores.set(clean, existing);
    };

    for (const r of results.slice(0, 7)) {
      const title = r.title;
      const snippet = r.snippet;

      // Pattern 1: Title starts with "<Name> - President and CEO, Company" or "<Name> - Co-Founder & CEO"
      const mTitle1 = title.match(
        /^([A-Z\p{L}][a-zA-Z\p{L}\.\-']*(?:\s+[A-Z\p{L}][a-zA-Z\p{L}\.\-']*){1,3})\s*[-–—|:]\s*(?:(?:Co-?Founder|Founder|Chairman|President)\s*(?:&|and|\/)\s*)?(?:CEO|Chief Executive Officer|Co-CEO|President & CEO)/iu,
      );
      if (mTitle1 && mTitle1[1]) {
        addCandidate(mTitle1[1], 10, r.url);
      }

      // Pattern 2: Title format "Meet <Name> - CEO of <Company>" or "<Name>, CEO of <Company>"
      const mTitle2 = title.match(
        /(?:Meet\s+|RENCONTRE AVEC\s+)?([A-Z\p{L}][a-zA-Z\p{L}\.\-']*(?:\s+[A-Z\p{L}][a-zA-Z\p{L}\.\-']*){1,3}),?\s+(?:is\s+)?(?:the\s+)?(?:Co-?Founder\s*(?:&|and)\s*)?(?:CEO|Chief Executive Officer|Co-CEO)\s+(?:of|at|de|chez)\s+/iu,
      );
      if (mTitle2 && mTitle2[1]) {
        addCandidate(mTitle2[1], 8, r.url);
      }

      // Split full text by sentence boundaries, protecting initials like T.J. or J.
      const textSegments = `${title}. ${snippet}`
        .split(/(?<!\b[A-Z\p{L}]|\b[A-Z\p{L}]\.[A-Z\p{L}])\.\s+|\.\.\.|\s*[·|•\n]\s*|\s*;\s*/u)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const seg of textSegments) {
        // Pattern 3: "<Name> is (the )?(co-founder and )?CEO of <Company>"
        const m3 = seg.match(
          /(?:^|,\s*)([A-Z\p{L}][a-zA-Z\p{L}\.\-']*(?:\s+[A-Z\p{L}][a-zA-Z\p{L}\.\-']*){1,3})\s+(?:is|has been|joined as|serves as|was appointed(?:\s+as)?)\s+(?:the\s+)?(?:current\s+)?(?:co-?founder\s+(?:and|&)\s+)?(?:CEO|Chief Executive Officer|President & CEO|Co-CEO)/iu,
        );
        if (m3 && m3[1]) {
          addCandidate(m3[1], 10, r.url);
        }

        // Pattern 4: "<Company>'s CEO is <Name>" or "CEO: <Name>" or "Chairman and CEO, <Name>,"
        const m4 = seg.match(
          /(?:CEO|Chief Executive Officer|Chairman and CEO|Founder, Chief Executive Officer)(?:\s+is|\s*[-–—:]|\s*,)\s*([A-Z\p{L}][a-zA-Z\p{L}\.\-']*(?:\s+[A-Z\p{L}][a-zA-Z\p{L}\.\-']*){1,3})/iu,
        );
        if (m4 && m4[1]) {
          addCandidate(m4[1], 10, r.url);
        }

        // Pattern 5: "<Name>, CEO of <Company>" in snippet segment
        const m5 = seg.match(
          /(?:^|,\s*)([A-Z\p{L}][a-zA-Z\p{L}\.\-']*(?:\s+[A-Z\p{L}][a-zA-Z\p{L}\.\-']*){1,3})(?:,\s*(?:the\s+)?(?:co-?founder\s+(?:and|&)\s+)?(?:CEO|Chief Executive Officer|Co-CEO))\s+(?:of|at|chez|de)\s+/iu,
        );
        if (m5 && m5[1]) {
          addCandidate(m5[1], 8, r.url);
        }

        // Pattern 6: Official leadership line "Chief Executive Officer. <Name>" or "CEO. <Name>"
        const m6 = seg.match(
          /(?:Chief Executive Officer|Co-Founder & Chief Executive Officer)\s*[:\-]\s*([A-Z\p{L}][a-zA-Z\p{L}\.\-']*(?:\s+[A-Z\p{L}][a-zA-Z\p{L}\.\-']*){1,3})/iu,
        );
        if (m6 && m6[1]) {
          addCandidate(m6[1], 8, r.url);
        }
      }

      // Pattern 7: Wikipedia title "John Doe (businessman)" or "John Doe - Wikipedia"
      if (r.url.includes("wikipedia.org/wiki/")) {
        const wikiName = r.title
          .replace(/\s*-\s*Wikipedia.*/i, "")
          .replace(/\s*\(.*\)/, "")
          .trim();
        if (
          isValidCeoName(wikiName, companyName) &&
          (snippet.toLowerCase().includes("ceo") ||
            snippet.toLowerCase().includes("chief executive officer"))
        ) {
          addCandidate(wikiName, 10, r.url);
        }
      }
    }

    let bestName = "N/A";
    let bestUrl = results[0]?.url || "";
    let bestScore = 0;
    let matchCount = 0;

    for (const [cand, data] of candidateScores.entries()) {
      if (data.score > bestScore) {
        bestScore = data.score;
        bestName = cand;
        bestUrl = data.url;
        matchCount = data.count;
      }
    }

    let confidence: "High" | "Medium" | "Low" | "N/A" = "Low";
    if (bestScore >= 10 || matchCount >= 2) {
      confidence = "High";
    } else if (bestScore >= 6) {
      confidence = "Medium";
    } else if (bestName === "N/A") {
      confidence = "N/A";
    }

    return {
      ceo_name: bestName,
      ceo_source_url: bestName !== "N/A" ? bestUrl : "",
      ceo_confidence: confidence,
      company_url: resolvedCompanyUrl,
    };
  }
}
