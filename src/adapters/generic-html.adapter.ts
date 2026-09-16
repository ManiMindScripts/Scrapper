import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { IJobAdapter } from "./base.adapter.js";
import type { BrowserManager } from "../browser/browser-manager.js";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  company_name?: string | undefined;
  location?: { name?: string | undefined } | undefined;
  first_published?: string | undefined;
  updated_at?: string | undefined;
  metadata?:
    | Array<{
        name?: string | undefined;
        value?:
          | {
              unit?: string | undefined;
              min_value?: string | number | undefined;
              max_value?: string | number | undefined;
            }
          | string
          | undefined;
      }>
    | undefined;
}

interface JBoardJob {
  id: number;
  title: string;
  job_details_path?: string | undefined;
  description?: string | undefined;
  location?: string | undefined;
  remote?: boolean | undefined;
  min_compensation?: string | number | undefined;
  max_compensation?: string | number | undefined;
  compensation_currency?: string | undefined;
  compensation_time_frame?: string | undefined;
  posted_at?: string | undefined;
  apply_to?: string | undefined;
  employer?: { name?: string | undefined } | undefined;
}

export class GenericHtmlAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind = "generic-html";

  async scrape(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    switch (source.id) {
      case "flagship-pioneering":
        return this.scrapeFlagshipGreenhouse(source);
      case "food-impact-careers":
        return this.scrapeFoodImpactCareers(source);
      case "s2g-investments":
        return this.scrapeS2GInvestments(source);
      case "pale-blue-dot":
        return this.scrapePaleBlueDot(source, browserManager);
      default:
        // Default generic HTML fallback using Playwright
        return this.scrapeGenericFallback(source, browserManager);
    }
  }

  /**
   * Flagship Pioneering: Public Greenhouse JSON API endpoint.
   */
  private async scrapeFlagshipGreenhouse(
    source: SourceConfig,
  ): Promise<RawJob[]> {
    const apiUrl =
      source.jsonApi.url ||
      "https://boards-api.greenhouse.io/v1/boards/flagshippioneeringinc/jobs";

    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(
        `Greenhouse API returned ${res.status} for Flagship Pioneering`,
      );
    }

    const data = (await res.json()) as { jobs?: GreenhouseJob[] };
    const jobsList = data.jobs || [];
    const rawJobs: RawJob[] = [];

    for (const job of jobsList) {
      if (!job.title || !job.absolute_url) continue;

      let salaryRaw = "";
      if (Array.isArray(job.metadata)) {
        const payMeta = job.metadata.find((m) =>
          /pay\s*range|salary/i.test(m.name || ""),
        );
        if (payMeta && typeof payMeta.value === "object" && payMeta.value !== null) {
          const val = payMeta.value;
          const min = val.min_value;
          const max = val.max_value;
          const unit = val.unit || "USD";
          if (min && max) {
            salaryRaw = `${unit} ${min} - ${max}`;
          }
        }
      }

      rawJobs.push({
        source: source.id,
        jobTitle: job.title.trim(),
        jobUrl: job.absolute_url.trim(),
        companyName: job.company_name?.trim() || "Flagship Pioneering",
        locationRaw: job.location?.name?.trim() || "",
        isRemote: /remote/i.test(job.location?.name || ""),
        salaryRaw,
        postedAtRaw: job.first_published || job.updated_at || "",
        jobDesc: "",
      });
    }

    return rawJobs;
  }

  /**
   * Food Impact Careers: JBoard pages with inlined window.jobsList JSON.
   */
  private async scrapeFoodImpactCareers(
    source: SourceConfig,
  ): Promise<RawJob[]> {
    const rawJobs: RawJob[] = [];
    const seenIds = new Set<number>();
    let pageNum = 1;
    const maxPages = 5; // safety ceiling

    while (pageNum <= maxPages) {
      const pageUrl = `https://www.foodimpactcareers.com/jobs?page=${pageNum}`;
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) break;

      const html = await res.text();
      const match = html.match(
        /window\.jobsList\s*=\s*window\.jobsList\.concat\((\[\{[\s\S]*?\}\])\);/,
      );

      if (!match || !match[1]) break;

      let batch: JBoardJob[] = [];
      try {
        batch = JSON.parse(match[1]);
      } catch {
        break;
      }

      if (batch.length === 0) break;

      let addedInPage = 0;
      for (const item of batch) {
        if (!item.id || !item.title || seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        const canonicalUrl = item.job_details_path
          ? `https://www.foodimpactcareers.com${item.job_details_path}`
          : `https://www.foodimpactcareers.com/jobs/${item.id}`;

        // Format compensation
        let salaryRaw = "";
        if (item.min_compensation && item.max_compensation) {
          const curr = (item.compensation_currency || "USD").toUpperCase();
          const frame = item.compensation_time_frame
            ? ` / ${item.compensation_time_frame}`
            : "";
          salaryRaw = `${curr} ${item.min_compensation} - ${item.max_compensation}${frame}`;
        }

        // Clean description HTML to text
        const cleanDesc = item.description
          ? item.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
          : "";

        rawJobs.push({
          source: source.id,
          jobTitle: item.title.trim(),
          jobUrl: canonicalUrl,
          companyName: item.employer?.name?.trim() || "Food Impact Careers",
          locationRaw: item.location?.trim() || "",
          isRemote: Boolean(item.remote) || /remote/i.test(item.location || ""),
          salaryRaw,
          postedAtRaw: item.posted_at || "",
          jobDesc: cleanDesc,
        });
        addedInPage++;
      }

      if (addedInPage === 0) break;

      pageNum++;
      // Crawl-delay: 1 second
      await new Promise((r) => setTimeout(r, 1000));
    }

    return rawJobs;
  }

  /**
   * S2G Investments: Paginated Craft CMS open-positions.
   */
  private async scrapeS2GInvestments(source: SourceConfig): Promise<RawJob[]> {
    const rawJobs: RawJob[] = [];
    const seenUrls = new Set<string>();
    let pageNum = 1;
    const maxPages = 5;

    while (pageNum <= maxPages) {
      const pageUrl = `https://www.s2ginvestments.com/team/careers/open-positions?page=${pageNum}`;
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
      });

      if (!res.ok) break;

      const html = await res.text();
      // Match card articles
      const articleMatches = [...html.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/gi)];
      if (articleMatches.length === 0) break;

      let added = 0;
      for (const m of articleMatches) {
        const cardHtml = m[1] || "";

        // Extract link & title
        const linkMatch = cardHtml.match(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!linkMatch) continue;

        const jobUrl = linkMatch[1]?.trim() || "";
        const jobTitle = linkMatch[2]?.replace(/<[^>]+>/g, "").trim() || "";

        if (!jobUrl || !jobTitle || seenUrls.has(jobUrl)) continue;
        seenUrls.add(jobUrl);

        // Extract company
        const companyMatch = cardHtml.match(/class="[^"]*text-label[^"]*">([\s\S]*?)<\/div>/i);
        const companyName = companyMatch
          ? companyMatch[1]?.replace(/<[^>]+>/g, "").trim() || "S2G Portfolio"
          : "S2G Portfolio";

        // LinkedIn policy check
        const isLinkedIn = /linkedin\.com\/jobs\/view/i.test(jobUrl);

        rawJobs.push({
          source: source.id,
          jobTitle,
          jobUrl,
          companyName,
          locationRaw: "",
          isRemote: false,
          salaryRaw: "",
          postedAtRaw: "",
          jobDesc: isLinkedIn ? "" : "",
        });
        added++;
      }

      if (added === 0) break;
      pageNum++;
      await new Promise((r) => setTimeout(r, 800));
    }

    return rawJobs;
  }

  /**
   * Pale Blue Dot: Loads with Playwright to bypass Cloudflare challenge and extract jobs.
   */
  private async scrapePaleBlueDot(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    if (!browserManager) {
      throw new Error("BrowserManager required for Pale Blue Dot");
    }

    const context = await browserManager.createContext();
    try {
      const page = await context.newPage();
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(4000);

      // Extract cards from the page
      const rawJobs = await page.$$eval(
        'li:has(a[href*="linkedin"], a[href*="ashbyhq"], a[href*="greenhouse"], a[class*="jobs-list_job-entry"])',
        (items, sourceId) => {
          return items.map((item) => {
            const anchor = item.querySelector("a") as HTMLAnchorElement | null;
            const jobUrl = anchor?.href || "";

            // Title
            const titleEl =
              item.querySelector('[class*="typography-headline"]') ||
              item.querySelector("h2, h3, h4") ||
              anchor;
            const jobTitle = titleEl?.textContent?.trim() || "";

            // Company
            let companyName = "";
            const allSpans = Array.from(item.querySelectorAll("span"));
            const compLabel = allSpans.find((s) => s.textContent?.trim() === "Company");
            if (compLabel?.nextElementSibling) {
              companyName = compLabel.nextElementSibling.textContent?.trim() || "";
            } else {
              const img = item.querySelector("img[alt]");
              companyName = img?.getAttribute("alt") || "";
            }

            // Location
            let locationRaw = "";
            const locLabel = allSpans.find((s) => s.textContent?.trim() === "Located");
            if (locLabel?.nextElementSibling) {
              locationRaw = locLabel.nextElementSibling.textContent?.trim() || "";
            }

            // Posted Date
            let postedAtRaw = "";
            const dateSpan = allSpans.find((s) => /posted/i.test(s.textContent || ""));
            if (dateSpan) {
              postedAtRaw = dateSpan.textContent?.trim() || "";
            }

            const isLinkedIn = /linkedin\.com\/jobs\/view/i.test(jobUrl);

            return {
              source: sourceId,
              jobTitle,
              jobUrl,
              companyName,
              locationRaw,
              isRemote: /remote/i.test(locationRaw),
              salaryRaw: "",
              postedAtRaw,
              jobDesc: isLinkedIn ? "" : "",
            };
          });
        },
        source.id,
      );

      return rawJobs.filter((j) => j.jobTitle && j.jobUrl);
    } finally {
      await context.close();
    }
  }

  private async scrapeGenericFallback(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    if (!browserManager) return [];
    const context = await browserManager.createContext();
    try {
      const page = await context.newPage();
      await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      return [];
    } finally {
      await context.close();
    }
  }
}
