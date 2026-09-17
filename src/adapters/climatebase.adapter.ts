import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { IJobAdapter } from "./base.adapter.js";
import type { BrowserManager } from "../browser/browser-manager.js";

const ALGOLIA_APP_ID = "8PSNFFQTXQ";
const ALGOLIA_API_KEY = "d2ebe27d3cc3d35fea04da7b1b0718a8";
const ALGOLIA_QUERY_URL = `https://${ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/Job_production/query`;

interface ClimatebaseJobItem {
  id?: number | string | undefined;
  objectID?: string | undefined;
  title?: string | undefined;
  name_of_employer?: string | undefined;
  locations?: string[] | undefined;
  remote_preferences?: string[] | undefined;
  salary_from?: number | string | undefined;
  salary_to?: number | string | undefined;
  salary_period?: string | undefined;
  activation_date?: string | undefined;
  employer_short_description?: string | undefined;
}

export interface ClimatebaseAdapterOptions {
  /** Maximum number of Algolia pages to scrape (100 jobs/page). Defaults to 50 (5,000 jobs). */
  maxPages?: number | undefined;
}

export class ClimatebaseAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind = "climatebase";
  private readonly maxPages: number;

  constructor(options: ClimatebaseAdapterOptions = {}) {
    this.maxPages = options.maxPages ?? 50;
  }

  async scrape(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    // Strategy 1: Fast Algolia API pagination (scalable to 10k+ jobs)
    try {
      const algoliaJobs = await this.scrapeViaAlgolia(source.id);
      if (algoliaJobs.length > 0) {
        return algoliaJobs;
      }
    } catch {
      // Algolia failed or blocked, fall through to SSR fallback
    }

    // Strategy 2: SSR __NEXT_DATA__ / Playwright fallback
    return this.scrapeViaSsr(source, browserManager);
  }

  private async scrapeViaAlgolia(sourceId: string): Promise<RawJob[]> {
    const rawJobs: RawJob[] = [];
    const seenUrls = new Set<string>();

    for (let page = 0; page < this.maxPages; page++) {
      const res = await fetch(ALGOLIA_QUERY_URL, {
        method: "POST",
        headers: {
          "x-algolia-application-id": ALGOLIA_APP_ID,
          "x-algolia-api-key": ALGOLIA_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: "",
          page,
          hitsPerPage: 100,
          facetFilters: ["active:true"],
        }),
      });

      if (!res.ok) {
        break;
      }

      const data = (await res.json()) as {
        hits?: ClimatebaseJobItem[];
        nbPages?: number;
      };

      const hits = data.hits || [];
      if (hits.length === 0) {
        break;
      }

      for (const item of hits) {
        const title = item.title?.trim() || "";
        const jobId = item.id || item.objectID;
        if (!title || !jobId) {
          continue;
        }

        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const jobUrl = `https://climatebase.org/job/${jobId}/${slug}`;

        if (seenUrls.has(jobUrl)) {
          continue;
        }
        seenUrls.add(jobUrl);

        const locations = Array.isArray(item.locations)
          ? item.locations.filter(Boolean).join(", ")
          : "";
        const isRemote =
          Array.isArray(item.remote_preferences) &&
          item.remote_preferences.some((r) => /remote/i.test(r));

        let salaryRaw = "";
        const from = item.salary_from ? String(item.salary_from).trim() : "";
        const to = item.salary_to ? String(item.salary_to).trim() : "";
        const period = item.salary_period ? `/${item.salary_period}` : "/year";

        if (from && to) {
          salaryRaw = `$${from} - $${to} ${period}`;
        } else if (from) {
          salaryRaw = `From $${from} ${period}`;
        } else if (to) {
          salaryRaw = `Up to $${to} ${period}`;
        }

        rawJobs.push({
          source: sourceId,
          jobTitle: title,
          jobUrl,
          companyName: item.name_of_employer?.trim() || "",
          locationRaw: locations,
          isRemote,
          salaryRaw,
          postedAtRaw: item.activation_date || "",
          jobDesc: item.employer_short_description?.trim() || "",
        });
      }

      if (data.nbPages !== undefined && page + 1 >= data.nbPages) {
        break;
      }
    }

    return rawJobs;
  }

  private async scrapeViaSsr(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    let html = "";

    try {
      const res = await fetch(source.url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (res.ok) {
        html = await res.text();
      }
    } catch {
      // Direct HTTP failed, proceed to Playwright fallback
    }

    if (!html && browserManager) {
      const context = await browserManager.createContext();
      try {
        const page = await context.newPage();
        await page.goto(source.url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        html = await page.content();
      } finally {
        await context.close();
      }
    }

    if (!html) {
      throw new Error(`Failed to retrieve page content for ${source.id}`);
    }

    const nextMatch = html.match(
      /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!nextMatch || !nextMatch[1]) {
      throw new Error(
        `__NEXT_DATA__ script tag not found on Climatebase page (${source.url})`,
      );
    }

    const data = JSON.parse(nextMatch[1]);
    const rawJobsList: ClimatebaseJobItem[] =
      data.props?.pageProps?.jobs ||
      data.props?.pageProps?.initialState?.jobs?.items ||
      [];

    const rawJobs: RawJob[] = [];
    const seenUrls = new Set<string>();

    for (const item of rawJobsList) {
      const title = item.title?.trim() || "";
      const jobId = item.id || item.objectID;
      if (!title || !jobId) {
        continue;
      }

      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const jobUrl = `https://climatebase.org/job/${jobId}/${slug}`;

      if (seenUrls.has(jobUrl)) {
        continue;
      }
      seenUrls.add(jobUrl);

      const locations = Array.isArray(item.locations)
        ? item.locations.filter(Boolean).join(", ")
        : "";
      const isRemote =
        Array.isArray(item.remote_preferences) &&
        item.remote_preferences.some((r) => /remote/i.test(r));

      let salaryRaw = "";
      const from = item.salary_from ? String(item.salary_from).trim() : "";
      const to = item.salary_to ? String(item.salary_to).trim() : "";
      const period = item.salary_period ? `/${item.salary_period}` : "/year";

      if (from && to) {
        salaryRaw = `$${from} - $${to} ${period}`;
      } else if (from) {
        salaryRaw = `From $${from} ${period}`;
      } else if (to) {
        salaryRaw = `Up to $${to} ${period}`;
      }

      rawJobs.push({
        source: source.id,
        jobTitle: title,
        jobUrl,
        companyName: item.name_of_employer?.trim() || "",
        locationRaw: locations,
        isRemote,
        salaryRaw,
        postedAtRaw: item.activation_date || "",
        jobDesc: item.employer_short_description?.trim() || "",
      });
    }

    return rawJobs;
  }
}
