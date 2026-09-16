import type { Job, RawJob } from "../types/job.types.js";
import { JobSchema } from "../types/job.schema.js";
import { parsePostedDate } from "../parsers/date.parser.js";
import { parseSalary } from "../parsers/salary.parser.js";

/**
 * Normalizes an adapter-specific RawJob into the canonical Job format,
 * parsing dates and salaries, setting initial timestamps, and validating against JobSchema.
 */
export function normalizeRawJob(raw: RawJob, now: Date = new Date()): Job {
  const nowIso = now.toISOString();
  const postedAt = parsePostedDate(raw.postedAtRaw, now);
  const salary = parseSalary(raw.salaryRaw);

  const candidate: Job = {
    source: raw.source.trim(),
    job_title: raw.jobTitle.trim(),
    job_url: raw.jobUrl.trim(),
    company_name: (raw.companyName ?? "").trim(),
    location_raw: (raw.locationRaw ?? "").trim(),
    is_remote: Boolean(raw.isRemote),
    salary_raw: (raw.salaryRaw ?? "").trim(),
    salary_min: salary.min,
    salary_max: salary.max,
    salary_currency: salary.currency,
    posted_at: postedAt,
    job_desc: (raw.jobDesc ?? "").trim(),
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    is_active: true,
  };

  return JobSchema.parse(candidate);
}

/**
 * Batch normalizes raw jobs, safely skipping or logging invalid records.
 */
export function normalizeRawJobs(
  rawJobs: RawJob[],
  now: Date = new Date(),
  onValidationError?: ((raw: RawJob, error: Error) => void) | undefined,
): Job[] {
  const normalized: Job[] = [];

  for (const raw of rawJobs) {
    try {
      normalized.push(normalizeRawJob(raw, now));
    } catch (err) {
      if (onValidationError) {
        onValidationError(raw, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  return normalized;
}
