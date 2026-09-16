import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { IJobAdapter } from "./base.adapter.js";
import type { BrowserManager } from "../browser/browser-manager.js";

/**
 * Skeleton stub adapter used in Phase 2 to wire up pipeline composition
 * prior to live adapter implementations in Phases 3 and 4.
 */
export class StubAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind;

  constructor(adapterId: AdapterKind) {
    this.adapterId = adapterId;
  }

  async scrape(
    source: SourceConfig,
    _browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    return [];
  }
}
