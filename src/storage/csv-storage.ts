import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import csvWriterPkg from "csv-writer";
import type { IJobStorage } from "./storage.interface.js";
import type { Job, SaveOptions, StorageSaveResult } from "../types/job.types.js";
import { JobSchema } from "../types/job.schema.js";
import { parseSeniority } from "../parsers/seniority.parser.js";
import { buildJobUniqueKey } from "../normalizer/job.normalizer.js";

const { createObjectCsvWriter } = csvWriterPkg;

export const CSV_FIELD_MAPPINGS = [
  { id: "company_name", title: "Company Name" },
  { id: "job_title", title: "Job Title" },
  { id: "job_desc", title: "Job Description" },
  { id: "job_apply_url", title: "Job Appy Url" },
  { id: "company_url", title: "Company Url" },
  { id: "location", title: "Location" },
  { id: "date_posted", title: "Date Posted" },
  { id: "source_board", title: "Scourse Board" },
  { id: "unique_key", title: "Unique Key" },
  { id: "ceo_name", title: "Ceo Name" },
  { id: "ceo_source_url", title: "Ceo Source Url" },
  { id: "ceo_confidence", title: "Ceo Confidence" },
  { id: "date_scraped", title: "Date Scraped" },
  { id: "seniority", title: "Seniority" },
  { id: "job_of_interest", title: "JOb of interest" },
] as const;

export function buildDedupeKey(uniqueKey: string): string {
  return uniqueKey.trim().toLowerCase();
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
   * Reads existing jobs from CSV. Auto-detects and converts legacy and new formats.
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
        const isNewFormat = "Company Name" in record || "Unique Key" in record;

        let candidate: Job;

        if (isNewFormat) {
          candidate = {
            company_name: (record["Company Name"] ?? "").trim(),
            job_title: (record["Job Title"] ?? "").trim(),
            job_desc: (record["Job Description"] ?? "").trim(),
            job_apply_url: (record["Job Appy Url"] ?? record["job_apply_url"] ?? "").trim(),
            company_url: (record["Company Url"] ?? "").trim(),
            location: (record["Location"] ?? "").trim(),
            date_posted: record["Date Posted"] && record["Date Posted"].trim() !== ""
              ? record["Date Posted"].trim()
              : null,
            source_board: (record["Scourse Board"] ?? record["source_board"] ?? "unknown").trim(),
            unique_key: (record["Unique Key"] ?? "").trim(),
            ceo_name: (record["Ceo Name"] ?? "N/A").trim(),
            ceo_source_url: (record["Ceo Source Url"] ?? "").trim(),
            ceo_confidence: (record["Ceo Confidence"] ?? "N/A").trim(),
            date_scraped: (record["Date Scraped"] ?? new Date().toISOString()).trim(),
            seniority: (record["Seniority"] ?? parseSeniority(record["Job Title"] || "")).trim(),
            job_of_interest: (record["JOb of interest"] ?? "Yes").trim(),
            is_active: record["is_active"] !== "false",
            first_seen_at: record["first_seen_at"] || record["Date Scraped"] || new Date().toISOString(),
            last_seen_at: record["last_seen_at"] || record["Date Scraped"] || new Date().toISOString(),
          };

          if (!candidate.unique_key) {
            candidate.unique_key = buildJobUniqueKey(
              candidate.company_name,
              candidate.job_title,
              candidate.location,
              /remote/i.test(candidate.location),
            );
          }
        } else {
          // Legacy format migration
          const companyName = (record["company_name"] ?? "").trim();
          const jobTitle = (record["job_title"] ?? "").trim();
          const locRaw = (record["location_raw"] ?? "").trim();
          const isRemote = record["is_remote"] === "true";
          const locationStr = locRaw
            ? `${locRaw}${isRemote && !/remote/i.test(locRaw) ? " (Remote)" : ""}`
            : isRemote
              ? "Remote"
              : "";

          const uniqueKey = buildJobUniqueKey(companyName, jobTitle, locRaw, isRemote);
          const seniority = parseSeniority(jobTitle);

          candidate = {
            company_name: companyName,
            job_title: jobTitle,
            job_desc: (record["job_desc"] ?? "").trim(),
            job_apply_url: (record["job_url"] ?? "").trim(),
            company_url: "",
            location: locationStr,
            date_posted: record["posted_at"] && record["posted_at"].trim() !== ""
              ? record["posted_at"].trim()
              : null,
            source_board: (record["source"] ?? "unknown").trim(),
            unique_key: uniqueKey,
            ceo_name: "N/A",
            ceo_source_url: "",
            ceo_confidence: "N/A",
            date_scraped: record["last_seen_at"] || record["first_seen_at"] || new Date().toISOString(),
            seniority,
            job_of_interest: "Yes",
            is_active: record["is_active"] === "true",
            first_seen_at: record["first_seen_at"] || new Date().toISOString(),
            last_seen_at: record["last_seen_at"] || new Date().toISOString(),
          };
        }

        const validated = JobSchema.parse(candidate);
        jobs.push(validated);
      } catch {
        // Skip corrupted row gracefully
      }
    }

    return jobs;
  }

  /**
   * Reads existing CSV, merges fresh jobs by Unique Key,
   * updates last_seen_at for seen jobs, sets first_seen_at for new jobs,
   * and safely writes to CSV.
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
      const key = buildDedupeKey(job.unique_key);
      jobMap.set(key, job);
    }

    let newJobs = 0;
    let updatedJobs = 0;
    let deactivatedJobs = 0;

    const freshKeySet = new Set<string>();

    for (const freshJob of freshJobs) {
      const validated = JobSchema.parse(freshJob);
      const key = buildDedupeKey(validated.unique_key);
      freshKeySet.add(key);

      const existing = jobMap.get(key);
      if (existing) {
        // Update mutable fields, keep CEO info if already enriched
        const merged: Job = {
          ...existing,
          job_title: validated.job_title,
          company_name: validated.company_name || existing.company_name,
          company_url: validated.company_url || existing.company_url,
          location: validated.location || existing.location,
          job_apply_url: validated.job_apply_url || existing.job_apply_url,
          date_posted: validated.date_posted ?? existing.date_posted,
          job_desc: validated.job_desc.length > existing.job_desc.length
            ? validated.job_desc
            : existing.job_desc,
          ceo_name: existing.ceo_name && existing.ceo_name !== "N/A"
            ? existing.ceo_name
            : validated.ceo_name,
          ceo_source_url: existing.ceo_source_url || validated.ceo_source_url,
          ceo_confidence: existing.ceo_confidence && existing.ceo_confidence !== "N/A"
            ? existing.ceo_confidence
            : validated.ceo_confidence,
          date_scraped: runIso,
          seniority: validated.seniority || existing.seniority,
          job_of_interest: validated.job_of_interest || existing.job_of_interest,
          last_seen_at: runIso,
          is_active: true,
        };
        jobMap.set(key, merged);
        updatedJobs++;
      } else {
        // New posting
        const created: Job = {
          ...validated,
          date_scraped: runIso,
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
        ? scrapedSources.has(job.source_board.toLowerCase())
        : true;

      if (isCandidateForDeactivation && !freshKeySet.has(key)) {
        if (job.is_active !== false) {
          jobMap.set(key, {
            ...job,
            is_active: false,
          });
          deactivatedJobs++;
        }
      }
    }

    // Sort: newest date_posted first, fallback to date_scraped descending
    const allJobs = Array.from(jobMap.values()).sort((a, b) => {
      const aTime = a.date_posted ? new Date(a.date_posted).getTime() : 0;
      const bTime = b.date_posted ? new Date(b.date_posted).getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      const aScraped = new Date(a.date_scraped).getTime();
      const bScraped = new Date(b.date_scraped).getTime();
      return bScraped - aScraped;
    });

    // Write back to CSV file
    await this.writeJobsToFile(allJobs);

    let totalActive = 0;
    let alreadyInactive = 0;
    for (const job of allJobs) {
      if (job.is_active !== false) {
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

    const records = jobs.map((job) => ({
      company_name: job.company_name,
      job_title: job.job_title,
      job_desc: job.job_desc,
      job_apply_url: job.job_apply_url,
      company_url: job.company_url,
      location: job.location,
      date_posted: job.date_posted ?? "",
      source_board: job.source_board,
      unique_key: job.unique_key,
      ceo_name: job.ceo_name,
      ceo_source_url: job.ceo_source_url,
      ceo_confidence: job.ceo_confidence,
      date_scraped: job.date_scraped,
      seniority: job.seniority,
      job_of_interest: job.job_of_interest,
    }));

    const tmpFilePath = `${this.filePath}.tmp.${Date.now()}`;
    const writer = createObjectCsvWriter({
      path: tmpFilePath,
      header: CSV_FIELD_MAPPINGS.map((m) => ({ id: m.id, title: m.title })),
    });

    await writer.writeRecords(records);

    // Atomically replace file
    try {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      fs.renameSync(tmpFilePath, this.filePath);
    } catch {
      fs.copyFileSync(tmpFilePath, this.filePath);
      if (fs.existsSync(tmpFilePath)) {
        fs.unlinkSync(tmpFilePath);
      }
    }
  }
}
