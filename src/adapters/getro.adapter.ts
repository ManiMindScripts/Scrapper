import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { IJobAdapter } from "./base.adapter.js";
import type { BrowserManager } from "../browser/browser-manager.js";

export interface GetroAdapterOptions {
  maxLoadMoreClicks?: number | undefined;
  defaultCrawlDelayMs?: number | undefined;
  navigationTimeoutMs?: number | undefined;
}

export class GetroAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind = "getro";
  private readonly options: GetroAdapterOptions;

  constructor(options: GetroAdapterOptions = {}) {
    this.options = {
      maxLoadMoreClicks: options.maxLoadMoreClicks ?? 50,
      defaultCrawlDelayMs: options.defaultCrawlDelayMs ?? 1000,
      navigationTimeoutMs: options.navigationTimeoutMs ?? 45000,
    };
  }

  async scrape(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    if (!browserManager) {
      throw new Error("BrowserManager is required for GetroAdapter");
    }

    const context = await browserManager.createContext();
    try {
      const page = await context.newPage();

      // Navigate to the board
      const gotoOptions: {
        waitUntil: "domcontentloaded";
        timeout?: number;
      } = {
        waitUntil: "domcontentloaded",
      };
      if (this.options.navigationTimeoutMs !== undefined) {
        gotoOptions.timeout = this.options.navigationTimeoutMs;
      }

      await page.goto(source.url, gotoOptions);

      // Wait for initial job cards to render
      await page
        .waitForSelector(
          '[data-testid="job-list-item"], .job-card, [itemtype*="JobPosting"]',
          { timeout: 15000 },
        )
        .catch(() => {
          // If selector times out, page might have 0 jobs or custom loading
        });

      // Handle crawl-delay from source config or default
      const crawlDelayMs =
        source.id === "dcvc" || /crawl-delay:\s*1/i.test(source.robots.notes)
          ? 1000
          : (this.options.defaultCrawlDelayMs ?? 800);

      // Pagination loop: click "Load more" until exhausted or ceiling reached
      let clicks = 0;
      let lastCardCount = 0;

      while (clicks < (this.options.maxLoadMoreClicks ?? 50)) {
        const currentCards = await page
          .locator('[data-testid="job-list-item"], .job-card')
          .count();

        // Check if "Load more" button is present and visible
        const loadMoreBtn = page
          .locator('button:has-text("Load more"), button[data-testid="load-more"]')
          .first();

        const isVisible = await loadMoreBtn.isVisible().catch(() => false);
        if (!isVisible) {
          break;
        }

        const isEnabled = await loadMoreBtn.isEnabled().catch(() => false);
        if (!isEnabled) {
          break;
        }

        // Click "Load more"
        await loadMoreBtn.scrollIntoViewIfNeeded().catch(() => null);
        await loadMoreBtn.click().catch(() => null);
        clicks++;

        // Wait crawl delay / for new cards to appear
        await page.waitForTimeout(crawlDelayMs);

        const newCardCount = await page
          .locator('[data-testid="job-list-item"], .job-card')
          .count();

        // If card count didn't increase, give one more brief pause or exit
        if (newCardCount === currentCards && newCardCount === lastCardCount) {
          break;
        }
        lastCardCount = newCardCount;
      }

      // Extract all job cards from the rendered page
      const baseUrl = page.url();
      const extracted = await page.$$eval(
        '[data-testid="job-list-item"], .job-card, [itemtype*="JobPosting"]',
        (cardElements, pageOrigin) => {
          return cardElements.map((card) => {
            // Job Title and Link
            const titleAnchor =
              (card.querySelector(
                'a[data-testid="job-title-link"]',
              ) as HTMLAnchorElement | null) ||
              (card.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement | null) ||
              (card.querySelector('h4 a') as HTMLAnchorElement | null);

            const jobTitle =
              titleAnchor?.textContent?.trim() ||
              card.querySelector('[itemprop="title"]')?.textContent?.trim() ||
              card.querySelector('.job-title-text')?.textContent?.trim() ||
              "";

            const rawHref = titleAnchor?.getAttribute("href") || "";
            let jobUrl = "";
            if (rawHref) {
              try {
                jobUrl = new URL(rawHref, pageOrigin).href;
              } catch {
                jobUrl = rawHref;
              }
            }

            // Company Name
            const companyAnchor = card.querySelector(
              'a[data-testid="company-link"]',
            );
            const companyMeta = card.querySelector(
              'meta[itemprop="name"]',
            );
            const companyName =
              companyAnchor?.textContent?.trim() ||
              companyMeta?.getAttribute("content")?.trim() ||
              "";

            // Location
            const locationMeta = card.querySelector(
              'meta[itemprop="addressLocality"]',
            );
            let locationRaw = locationMeta?.getAttribute("content")?.trim() || "";
            if (!locationRaw) {
              // Find leaf element with "Location:" text
              const allElements = Array.from(card.querySelectorAll("span, div, p"));
              const locLabel = allElements.find((el) => {
                const text = el.textContent?.trim() || "";
                return el.children.length === 0 && /^Location:/i.test(text);
              });
              if (locLabel) {
                locationRaw =
                  locLabel.nextElementSibling?.textContent?.trim() ||
                  locLabel.parentElement?.textContent?.replace(/^Location:\s*/i, "").trim() ||
                  "";
              }
            }

            // Remote indicator
            const isRemote =
              /remote/i.test(locationRaw) ||
              Boolean(
                Array.from(card.querySelectorAll('[data-testid="tag"], .tag')).some(
                  (tag) => /remote/i.test(tag.textContent || ""),
                ),
              );

            // Salary / Compensation
            let salaryRaw = "";
            const allElements = Array.from(card.querySelectorAll("span, div, p"));
            const compLabel = allElements.find((el) => {
              const text = el.textContent?.trim() || "";
              return el.children.length === 0 && /^Compensation:/i.test(text);
            });
            if (compLabel) {
              const p = compLabel.parentElement?.querySelector("p");
              if (p) {
                salaryRaw = p.textContent?.trim() || "";
              } else if (compLabel.nextElementSibling) {
                salaryRaw = compLabel.nextElementSibling.textContent?.trim() || "";
              } else {
                salaryRaw =
                  compLabel.parentElement?.textContent?.replace(/^Compensation:\s*/i, "").trim() ||
                  "";
              }
            }

            // Clean up: salary must contain numbers or currency symbols
            if (!/(\d|[$€£]|AUD|CAD|USD|EUR|GBP)/i.test(salaryRaw)) {
              salaryRaw = "";
            }

            // Posted At (meta datePosted has exact YYYY-MM-DD or relative text)
            const dateMeta = card.querySelector('meta[itemprop="datePosted"]');
            let postedAtRaw = dateMeta?.getAttribute("content")?.trim() || "";
            if (!postedAtRaw) {
              const postedLabel = Array.from(card.querySelectorAll("span, div")).find(
                (el) => el.textContent?.trim().startsWith("Posted:"),
              );
              if (postedLabel?.parentElement) {
                postedAtRaw =
                  postedLabel.parentElement.textContent
                    ?.replace(/posted:/i, "")
                    .trim() || "";
              }
            }

            // Description
            const descMeta = card.querySelector('meta[itemprop="description"]');
            const jobDesc = descMeta?.getAttribute("content")?.trim() || "";

            return {
              jobTitle,
              jobUrl,
              companyName,
              locationRaw,
              isRemote,
              salaryRaw,
              postedAtRaw,
              jobDesc,
            };
          });
        },
        baseUrl,
      );

      // Map to RawJob records with source ID and policy enforcement
      const rawJobs: RawJob[] = [];
      const seenUrls = new Set<string>();

      for (const item of extracted) {
        if (!item.jobTitle || !item.jobUrl) {
          continue;
        }

        // Dedupe within single scrape page
        if (seenUrls.has(item.jobUrl)) {
          continue;
        }
        seenUrls.add(item.jobUrl);

        // Enforce skip_linkedin policy: never scrape LinkedIn job pages, leave job_desc blank
        const isLinkedIn = /linkedin\.com\/jobs\/view/i.test(item.jobUrl);
        const finalJobDesc = isLinkedIn ? "" : item.jobDesc;

        rawJobs.push({
          source: source.id,
          jobTitle: item.jobTitle,
          jobUrl: item.jobUrl,
          companyName: item.companyName,
          locationRaw: item.locationRaw,
          isRemote: item.isRemote,
          salaryRaw: item.salaryRaw,
          postedAtRaw: item.postedAtRaw,
          jobDesc: finalJobDesc,
        });
      }

      return rawJobs;
    } finally {
      await context.close();
    }
  }
}
