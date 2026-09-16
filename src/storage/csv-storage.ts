import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import csvWriterPkg from "csv-writer";
import type { IJobStorage } from "./storage.interface.js";
import type { Job, SaveOptions, StorageSaveResult } from "../types/job.types.js";
import { JobSchema } from "../types/job.schema.js";

const { createObjectCsvWriter } = csvWriterPkg;

export const CANONICAL_CSV_COLUMNS = [
  "source",
  "job_title",
  "job_url",
  "company_name",
  "location_raw",
  "is_remote",
  "salary_raw",
  "salary_min",
  "salary_max",
  "salary_currency",
  "posted_at",
  "job_desc",
  "first_seen_at",
  "last_seen_at",
  "is_active",
] as const;

export type CanonicalCsvColumn = (typeof CANONICAL_CSV_COLUMNS)[number];

export function buildDedupeKey(source: string, jobUrl: string): string {
  return `${source.trim().toLowerCase()}:::${jobUrl.trim().toLowerCase()}`;
}

export class CsvStorage implements IJobStorage {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Reads existing jobs from CSV. Returns empty array if file does not exist.
   */
  async loadExisting(): Promise<Job[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const fileContent = fs.readFileSync(this.filePath, "utf-8");
    if (!fileContent.trim()) {
      return [];
    }

    const rawRecords = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    const jobs: Job[] = [];

    for (const record of rawRecords) {
      try {
        const candidate: Job = {
          source: (record["source"] ?? "").trim(),
          job_title: (record["job_title"] ?? "").trim(),
          job_url: (record["job_url"] ?? "").trim(),
          company_name: (record["company_name"] ?? "").trim(),
          location_raw: (record["location_raw"] ?? "").trim(),
          is_remote: record["is_remote"] === "true",
          salary_raw: (record["salary_raw"] ?? "").trim(),
          salary_min:
            record["salary_min"] && record["salary_min"].trim() !== ""
              ? Number(record["salary_min"])
              : null,
          salary_max:
            record["salary_max"] && record["salary_max"].trim() !== ""
              ? Number(record["salary_max"])
              : null,
          salary_currency:
            record["salary_currency"] && record["salary_currency"].trim() !== ""
              ? record["salary_currency"].trim()
              : null,
          posted_at:
            record["posted_at"] && record["posted_at"].trim() !== ""
              ? record["posted_at"].trim()
              : null,
          job_desc: (record["job_desc"] ?? "").trim(),
          first_seen_at: (record["first_seen_at"] ?? "").trim(),
          last_seen_at: (record["last_seen_at"] ?? "").trim(),
          is_active: record["is_active"] === "true",
        };

        const validated = JobSchema.parse(candidate);
        jobs.push(validated);
      } catch {
        // Skip unparseable or corrupted row gracefully
      }
    }

    return jobs;
  }

  /**
   * Reads existing CSV, merges fresh jobs by (source, job_url),
   * updates last_seen_at for seen jobs, sets first_seen_at for new jobs,
   * deactivates absent jobs for the scraped sources, and safely writes to CSV.
   */
  async save(
    freshJobs: Job[],
    options: SaveOptions = {},
  ): Promise<StorageSaveResult> {
    const runDate = options.now ?? new Date();
    const runIso = runDate.toISOString();

    const existingJobs = await this.loadExisting();
    const jobMap = new Map<string, Job>();

    for (const job of existingJobs) {
      const key = buildDedupeKey(job.source, job.job_url);
      jobMap.set(key, job);
    }

    let newJobs = 0;
    let updatedJobs = 0;
    let deactivatedJobs = 0;

    const freshKeySet = new Set<string>();

    for (const freshJob of freshJobs) {
      // Validate each fresh job with Zod before doing anything
      const validated = JobSchema.parse(freshJob);
      const key = buildDedupeKey(validated.source, validated.job_url);
      freshKeySet.add(key);

      const existing = jobMap.get(key);
      if (existing) {
        // Update mutable fields and last_seen_at
        const merged: Job = {
          ...existing,
          job_title: validated.job_title,
          company_name: validated.company_name || existing.company_name,
          location_raw: validated.location_raw || existing.location_raw,
          is_remote: validated.is_remote,
          salary_raw: validated.salary_raw || existing.salary_raw,
          salary_min: validated.salary_min ?? existing.salary_min,
          salary_max: validated.salary_max ?? existing.salary_max,
          salary_currency: validated.salary_currency ?? existing.salary_currency,
          posted_at: validated.posted_at ?? existing.posted_at,
          job_desc: validated.job_desc || existing.job_desc,
          last_seen_at: runIso,
          is_active: true,
        };
        jobMap.set(key, merged);
        updatedJobs++;
      } else {
        // New posting
        const created: Job = {
          ...validated,
          first_seen_at: runIso,
          last_seen_at: runIso,
          is_active: true,
        };
        jobMap.set(key, created);
        newJobs++;
      }
    }

    // Scoped deactivation: mark inactive for sources that were scraped in this run
    const scrapedSources = options.scrapedSourceIds
      ? new Set(options.scrapedSourceIds.map((s) => s.toLowerCase()))
      : null;

    for (const [key, job] of jobMap.entries()) {
      const isCandidateForDeactivation = scrapedSources
        ? scrapedSources.has(job.source.toLowerCase())
        : true;

      if (isCandidateForDeactivation && !freshKeySet.has(key)) {
        if (job.is_active) {
          jobMap.set(key, {
            ...job,
            is_active: false,
          });
          deactivatedJobs++;
        }
      }
    }

    // Sort: newest posted_at first, fallback to last_seen_at descending
    const allJobs = Array.from(jobMap.values()).sort((a, b) => {
      const aTime = a.posted_at ? new Date(a.posted_at).getTime() : 0;
      const bTime = b.posted_at ? new Date(b.posted_at).getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      const aSeen = new Date(a.last_seen_at).getTime();
      const bSeen = new Date(b.last_seen_at).getTime();
      return bSeen - aSeen;
    });

    // Write back to CSV file
    await this.writeJobsToFile(allJobs);

    let totalActive = 0;
    let alreadyInactive = 0;
    for (const job of allJobs) {
      if (job.is_active) {
        totalActive++;
      } else {
        alreadyInactive++;
      }
    }

    return {
      totalRows: allJobs.length,
      totalActive,
      newJobs,
      updatedJobs,
      deactivatedJobs,
      alreadyInactive,
    };
  }

  private async writeJobsToFile(jobs: Job[]): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Format records to exact primitive string representations
    const records = jobs.map((job) => ({
      source: job.source,
      job_title: job.job_title,
      job_url: job.job_url,
      company_name: job.company_name,
      location_raw: job.location_raw,
      is_remote: job.is_remote ? "true" : "false",
      salary_raw: job.salary_raw,
      salary_min: job.salary_min != null ? String(job.salary_min) : "",
      salary_max: job.salary_max != null ? String(job.salary_max) : "",
      salary_currency: job.salary_currency ?? "",
      posted_at: job.posted_at ?? "",
      job_desc: job.job_desc,
      first_seen_at: job.first_seen_at,
      last_seen_at: job.last_seen_at,
      is_active: job.is_active ? "true" : "false",
    }));

    const tmpFilePath = `${this.filePath}.tmp.${Date.now()}`;
    const writer = createObjectCsvWriter({
      path: tmpFilePath,
      header: CANONICAL_CSV_COLUMNS.map((col) => ({ id: col, title: col })),
    });

    await writer.writeRecords(records);

    // Atomically replace file
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      fs.renameSync(tmpFilePath, this.filePath);
    } catch {
      // Fallback copy if rename fails across file system boundaries
      fs.copyFileSync(tmpFilePath, this.filePath);
      if (fs.existsSync(tmpFilePath)) {
        fs.unlinkSync(tmpFilePath);
      }
    }
  }
}
