import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { IJobAdapter } from "./base.adapter.js";
import type { BrowserManager } from "../browser/browser-manager.js";

export class ConsiderAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind = "consider";

  async scrape(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    if (!browserManager) {
      throw new Error("BrowserManager is required for ConsiderAdapter");
    }

    const context = await browserManager.createContext();
    try {
      const page = await context.newPage();
      await page.goto(source.url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      // Wait for job list elements to render
      await page
        .waitForSelector(
          ".job-list-job-title, [class*='job-list-row'], .job-boards-masthead",
          { timeout: 15000 },
        )
        .catch(() => null);

      // Brief wait for full dynamic listings to mount
      await page.waitForTimeout(3000);

      const rawJobs = await page.$$eval(
        ".job-list-job-title a, a[href*='greenhouse.io'], a[href*='ashbyhq.com'], a[href*='workable.com'], a[href*='comeet.com'], a[href*='lever.co']",
        (anchors, sourceId) => {
          const results: Array<{
            source: string;
            jobTitle: string;
            jobUrl: string;
            companyName: string;
            locationRaw: string;
            isRemote: boolean;
            salaryRaw: string;
            postedAtRaw: string;
            jobDesc: string;
          }> = [];

          const seen = new Set<string>();

          for (const el of anchors) {
            const anchor = el as HTMLAnchorElement;
            const jobUrl = anchor.href;
            const jobTitle = anchor.textContent?.trim() || "";

            if (!jobUrl || !jobTitle || seen.has(jobUrl)) continue;
            seen.add(jobUrl);

            // Find row container
            const container =
              anchor.closest(".job-list-job, [class*='job-list-row'], li, tr") ||
              anchor.parentElement?.parentElement;

            let companyName = "";
            let locationRaw = "";
            let salaryRaw = "";
            let postedAtRaw = "";

            if (container) {
              // Company link usually points to /jobs/<company>
              const companyLink = container.querySelector(
                "a[href*='/jobs/'], [class*='company']",
              );
              companyName = companyLink?.textContent?.trim() || "";

              // Location
              const locEl = container.querySelector(
                "[class*='location'], [class*='city']",
              );
              locationRaw = locEl?.textContent?.trim() || "";

              // Salary
              const compEl = container.querySelector(
                "[class*='compensation'], [class*='salary']",
              );
              salaryRaw = compEl?.textContent?.trim() || "";

              // Date
              const dateEl = container.querySelector(
                "[class*='date'], [class*='time'], [class*='posted']",
              );
              postedAtRaw = dateEl?.textContent?.trim() || "";
            }

            const isRemote =
              /remote/i.test(locationRaw) || /remote/i.test(jobTitle);
            const isLinkedIn = /linkedin\.com\/jobs\/view/i.test(jobUrl);

            results.push({
              source: sourceId,
              jobTitle,
              jobUrl,
              companyName,
              locationRaw,
              isRemote,
              salaryRaw,
              postedAtRaw,
              jobDesc: isLinkedIn ? "" : "",
            });
          }

          return results;
        },
        source.id,
      );

      return rawJobs;
    } finally {
      await context.close();
    }
  }
}
