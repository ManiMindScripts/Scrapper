import type { SourceConfig, StorageSaveResult } from "../types/job.types.js";
import type { PipelineAlert } from "./alert.js";

export interface SourceRunStat {
  sourceId: string;
  displayName: string;
  adapter: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED" | "WARNING";
  jobsCount: number;
  errorMessage?: string | undefined;
}

export interface RunSummaryData {
  startTime: Date;
  endTime: Date;
  sources: SourceConfig[];
  sourceStats: SourceRunStat[];
  storageResult?: StorageSaveResult | undefined;
  dryRun?: boolean | undefined;
  alerts?: PipelineAlert[] | undefined;
}

export class RunSummary {
  static format(data: RunSummaryData): string {
    const durationMs = data.endTime.getTime() - data.startTime.getTime();
    const durationSec = (durationMs / 1000).toFixed(2);
    const modeStr = data.dryRun ? "DRY RUN / SKELETON MODE" : "LIVE RUN";

    const totalSources = data.sources.length;
    const succeeded = data.sourceStats.filter((s) => s.status === "SUCCESS").length;
    const warnings = data.sourceStats.filter((s) => s.status === "WARNING").length;
    const failed = data.sourceStats.filter((s) => s.status === "FAILED").length;
    const skipped = data.sourceStats.filter((s) => s.status === "SKIPPED").length;

    const lines: string[] = [];
    lines.push("================================================================================");
    lines.push(`                        JOB SCRAPER RUN SUMMARY (${modeStr})`);
    lines.push("================================================================================");
    lines.push(
      `Run Duration     : ${durationSec}s (${data.startTime.toISOString()} -> ${data.endTime.toISOString()})`,
    );
    lines.push(
      `Sources Processed: ${totalSources} total | ${succeeded} succeeded | ${warnings} warnings | ${failed} failed | ${skipped} skipped`,
    );

    if (data.alerts && data.alerts.length > 0) {
      lines.push("");
      lines.push("ACTIVE ALERTS / ANOMALIES DETECTED:");
      for (const alert of data.alerts) {
        lines.push(`  [!] [${alert.kind}] [${alert.sourceId}] ${alert.message}`);
      }
    }

    if (data.storageResult) {
      const res = data.storageResult;
      const newCount = (res.newJobs ?? 0).toString().padStart(6);
      const updateCount = (res.updatedJobs ?? 0).toString().padStart(6);
      const deactCount = (res.deactivatedJobs ?? 0).toString().padStart(6);
      const activeCount = (res.totalActive ?? res.totalRows ?? 0).toString().padStart(6);
      const totalCount = (res.totalRows ?? 0).toString().padStart(6);

      lines.push("");
      lines.push("POSTING DYNAMICS (data/jobs.csv):");
      lines.push(
        `  [+] New Postings        : ${newCount} (discovered for first time, first_seen_at = now)`,
      );
      lines.push(
        `  [*] Still-Active        : ${updateCount} (re-verified active, last_seen_at updated)`,
      );
      lines.push(
        `  [-] Closed Postings     : ${deactCount} (omitted from current scrape -> is_active: false)`,
      );
      lines.push("  " + "-".repeat(74));
      lines.push(
        `  (=) Total Active Jobs   : ${activeCount} (currently open listings across all boards)`,
      );
      lines.push(
        `  (#) Total Tracked Jobs  : ${totalCount} (all active + closed listings in CSV)`,
      );
    }

    lines.push("");
    lines.push("SOURCE BREAKDOWN:");
    lines.push(
      `  ${"SOURCE ID".padEnd(24)} ${"ADAPTER".padEnd(16)} ${"JOBS".padStart(6)}   ${"STATUS"}`,
    );
    lines.push("  " + "-".repeat(74));

    for (const stat of data.sourceStats) {
      const idStr = stat.sourceId.padEnd(24);
      const adapterStr = stat.adapter.padEnd(16);
      const countStr = stat.jobsCount.toString().padStart(6);
      let statusStr = stat.status as string;
      if (stat.errorMessage) {
        statusStr += ` (${stat.errorMessage})`;
      }
      lines.push(`  ${idStr} ${adapterStr} ${countStr}   ${statusStr}`);
    }

    lines.push("================================================================================");

    return lines.join("\n");
  }
}
