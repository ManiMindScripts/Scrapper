import type { AdapterKind, Job, RawJob, SourceConfig, StorageSaveResult } from "../types/job.types.js";
import type { IJobAdapter } from "../adapters/base.adapter.js";
import type { IJobStorage } from "../storage/storage.interface.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import { Logger, defaultLogger } from "./logger.js";
import { normalizeRawJobs } from "../normalizer/job.normalizer.js";
import type { CeoEnricher } from "../enrichers/ceo.enricher.js";
import { RunSummary, type SourceRunStat } from "./run-summary.js";
import { AlertManager, type PipelineAlert } from "./alert.js";
import { withRetry } from "../utils/retry.js";

export interface RunScraperOptions {
  sources: SourceConfig[];
  adapters: Map<AdapterKind, IJobAdapter>;
  storage: IJobStorage;
  browserManager?: BrowserManager | undefined;
  ceoEnricher?: CeoEnricher | undefined;
  logger?: Logger | undefined;
  /**
   * When true (default in Phase 2 skeleton), only logs planned scrapes without executing browser/HTTP calls.
   */
  dryRun?: boolean | undefined;
  /**
   * Optional filter to run only specific source IDs.
   */
  sourceIds?: string[] | undefined;
  /**
   * Maximum retries for transient failures per source. Defaults to 2.
   */
  maxRetries?: number | undefined;
}

export interface RunScraperResult {
  totalSources: number;
  scrapedSources: string[];
  failedSources: string[];
  skippedSources: string[];
  storageResult?: StorageSaveResult | undefined;
  alerts: PipelineAlert[];
  summaryText: string;
}

/**
 * Core pipeline orchestrator. Depends purely on interfaces (IJobAdapter, IJobStorage).
 * Handles per-source isolation, retries, 0-results markup change detection,
 * anti-wipeout safeguards, normalization, persistence, and detailed run summary generation.
 */
export async function runScraper(
  options: RunScraperOptions,
): Promise<RunScraperResult> {
  const logger = options.logger ?? defaultLogger;
  const isDryRun = options.dryRun ?? true;
  const startTime = new Date();
  const alertManager = new AlertManager();

  const targetSources = options.sourceIds
    ? options.sources.filter((s) => options.sourceIds!.includes(s.id))
    : options.sources;

  const scrapedSources: string[] = [];
  const failedSources: string[] = [];
  const skippedSources: string[] = [];
  const sourceStats: SourceRunStat[] = [];
  const allFreshJobs: Job[] = [];

  logger.info(
    `Starting scraper run (${isDryRun ? "DRY RUN / SKELETON MODE" : "LIVE MODE"}). Total sources: ${targetSources.length}`,
    "pipeline",
  );

  for (const source of targetSources) {
    if (!source.enabled) {
      logger.info(
        `Skipping disabled source: ${source.displayName} (${source.id})`,
        source.id,
      );
      skippedSources.push(source.id);
      sourceStats.push({
        sourceId: source.id,
        displayName: source.displayName,
        adapter: source.adapter,
        status: "SKIPPED",
        jobsCount: 0,
        errorMessage: "Disabled in config",
      });
      continue;
    }

    const adapter = options.adapters.get(source.adapter);
    if (!adapter) {
      const msg = `Unregistered adapter: '${source.adapter}'`;
      logger.warn(msg, source.id);
      failedSources.push(source.id);
      alertManager.record("SOURCE_FAILED", source.id, msg);
      sourceStats.push({
        sourceId: source.id,
        displayName: source.displayName,
        adapter: source.adapter,
        status: "FAILED",
        jobsCount: 0,
        errorMessage: msg,
      });
      continue;
    }

    if (isDryRun) {
      logger.info(
        `[SKELETON] Would scrape ${source.displayName} [${source.id}] via adapter '${source.adapter}' (${source.url})`,
        source.id,
      );
      scrapedSources.push(source.id);
      sourceStats.push({
        sourceId: source.id,
        displayName: source.displayName,
        adapter: source.adapter,
        status: "SUCCESS",
        jobsCount: 0,
      });
      continue;
    }

    // Live scrape execution with retries
    logger.info(
      `Scraping ${source.displayName} via adapter '${source.adapter}' (${source.url})`,
      source.id,
    );

    try {
      const rawJobs: RawJob[] = await withRetry(
        async () => {
          return await adapter.scrape(source, options.browserManager);
        },
        {
          maxRetries: options.maxRetries ?? 2,
          delayMs: 1500,
          backoffFactor: 2,
          logger,
          tag: source.id,
        },
      );

      // Hardening: 0-results markup change detection & anti-wipeout safeguard
      if (rawJobs.length === 0) {
        const warningMsg =
          "0 jobs returned (potential markup/selector change or empty board)";
        logger.warn(
          `[ALERT] [MARKUP_CHANGE_SUSPECTED] Source '${source.id}' returned 0 jobs. Site may have changed markup or pagination. Anti-wipeout active: existing jobs preserved.`,
          source.id,
        );

        alertManager.record("ZERO_RESULTS", source.id, warningMsg);
        sourceStats.push({
          sourceId: source.id,
          displayName: source.displayName,
          adapter: source.adapter,
          status: "WARNING",
          jobsCount: 0,
          errorMessage: warningMsg,
        });

        // Anti-wipeout: do NOT add source.id to scrapedSources so existing jobs are not deactivated
        continue;
      }

      const normalizedJobs = await normalizeRawJobs(
        rawJobs,
        options.ceoEnricher,
        new Date(),
        (raw, normErr) => {
          const errMsg = normErr instanceof Error ? normErr.message : String(normErr);
          logger.warn(
            `Validation error on job '${raw.jobTitle}' (${raw.jobUrl}): ${errMsg}`,
            source.id,
          );
        },
      );

      allFreshJobs.push(...normalizedJobs);
      scrapedSources.push(source.id);
      sourceStats.push({
        sourceId: source.id,
        displayName: source.displayName,
        adapter: source.adapter,
        status: "SUCCESS",
        jobsCount: normalizedJobs.length,
      });

      logger.info(
        `Successfully scraped ${normalizedJobs.length} valid jobs from ${source.id}`,
        source.id,
      );
    } catch (err) {
      // Fail per-source: log error, record failure, and proceed with the rest of the run
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to scrape source ${source.id}: ${msg}`, source.id, err);
      failedSources.push(source.id);
      alertManager.record("SOURCE_FAILED", source.id, msg);
      sourceStats.push({
        sourceId: source.id,
        displayName: source.displayName,
        adapter: source.adapter,
        status: "FAILED",
        jobsCount: 0,
        errorMessage: msg,
      });
    }
  }

  // Persist if in live mode or if jobs were collected
  let storageResult: StorageSaveResult | undefined;
  if (!isDryRun && scrapedSources.length > 0) {
    logger.info(
      `Saving ${allFreshJobs.length} fresh jobs across ${scrapedSources.length} sources to storage...`,
      "pipeline",
    );
    try {
      storageResult = await options.storage.save(allFreshJobs, {
        scrapedSourceIds: scrapedSources,
      });
      logger.info(
        `Storage update complete: ${storageResult.totalRows} total, ${storageResult.newJobs} new, ${storageResult.updatedJobs} updated, ${storageResult.deactivatedJobs} deactivated`,
        "pipeline",
      );
    } catch (saveErr) {
      logger.error(
        `Failed to persist jobs to storage: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
        "pipeline",
        saveErr,
      );
    }
  }

  const endTime = new Date();
  const alerts = alertManager.getAlerts();
  const summaryText = RunSummary.format({
    startTime,
    endTime,
    sources: targetSources,
    sourceStats,
    storageResult,
    dryRun: isDryRun,
    alerts,
  });

  // Log full structured summary banner
  console.log("\n" + summaryText + "\n");

  return {
    totalSources: targetSources.length,
    scrapedSources,
    failedSources,
    skippedSources,
    storageResult,
    alerts,
    summaryText,
  };
}
