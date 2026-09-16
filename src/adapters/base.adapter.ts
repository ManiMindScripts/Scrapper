import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { BrowserManager } from "../browser/browser-manager.js";

/**
 * Platform adapter contract. Each adapter handles scraping for one platform
 * (e.g. getro, consider, climatebase, generic-html) and yields RawJob records.
 */
export interface IJobAdapter {
  readonly adapterId: AdapterKind;

  /**
   * Scrapes listings for a configured source.
   * @param source The source configuration.
   * @param browserManager Optional browser manager for boards requiring browser execution.
   */
  scrape(
    source: SourceConfig,
    browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]>;
}
