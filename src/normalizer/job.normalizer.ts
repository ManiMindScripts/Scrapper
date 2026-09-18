import type { Job, RawJob, CeoInfo } from "../types/job.types.js";
import { JobSchema } from "../types/job.schema.js";
import { parsePostedDate } from "../parsers/date.parser.js";
import { parseSeniority } from "../parsers/seniority.parser.js";
import { extractCompanyUrl } from "../parsers/company-url.parser.js";
import type { CeoEnricher } from "../enrichers/ceo.enricher.js";

/**
 * Builds a deterministic, cross-board unique key for global deduplication.
 */
export function buildJobUniqueKey(
  companyName: string,
  jobTitle: string,
  locationRaw: string,
  isRemote: boolean,
): string {
  const cleanCompany = (companyName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const cleanTitle = (jobTitle || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const locSignature = isRemote
    ? "remote"
    : (locationRaw || "unspecified")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

  return `${cleanCompany}:::${cleanTitle}:::${locSignature}`;
}

/**
 * Normalizes an adapter-specific RawJob into the canonical 15-column Job format.
 */
export function normalizeRawJob(
  raw: RawJob,
  ceoInfo?: CeoInfo | undefined,
  now: Date = new Date(),
): Job {
  const nowIso = now.toISOString();
  const postedAt = parsePostedDate(raw.postedAtRaw, now);
  const isRemote = Boolean(raw.isRemote);
  const locationStr = raw.locationRaw
    ? `${raw.locationRaw.trim()}${isRemote && !/remote/i.test(raw.locationRaw) ? " (Remote)" : ""}`
    : isRemote
      ? "Remote"
      : "";

  const uniqueKey = buildJobUniqueKey(
    raw.companyName || "",
    raw.jobTitle || "",
    raw.locationRaw || "",
    isRemote,
  );

  const seniority = parseSeniority(raw.jobTitle || "");
  const applyUrl = raw.applyUrl || raw.jobUrl || "";
  const companyUrl =
    raw.companyUrl ||
    ceoInfo?.company_url ||
    extractCompanyUrl(applyUrl, raw.companyName);

  const candidate: Job = {
    company_name: (raw.companyName ?? "").trim(),
    job_title: (raw.jobTitle ?? "").trim(),
    job_desc: (raw.jobDesc ?? "").trim(),
    job_apply_url: applyUrl.trim(),
    company_url: companyUrl.trim(),
    location: locationStr.trim(),
    date_posted: postedAt,
    source_board: raw.source.trim(),
    unique_key: uniqueKey,
    ceo_name: ceoInfo?.ceo_name || "N/A",
    ceo_source_url: ceoInfo?.ceo_source_url || "",
    ceo_confidence: ceoInfo?.ceo_confidence || "N/A",
    date_scraped: nowIso,
    seniority,
    job_of_interest: "Yes",
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    is_active: true,
  };

  return JobSchema.parse(candidate);
}

/**
 * Batch normalizes raw jobs with optional asynchronous CEO enrichment.
 */
export async function normalizeRawJobs(
  rawJobs: RawJob[],
  ceoEnricher?: CeoEnricher | undefined,
  now: Date = new Date(),
  onValidationError?: ((raw: RawJob, error: Error) => void) | undefined,
): Promise<Job[]> {
  const normalized: Job[] = [];

  for (const raw of rawJobs) {
    try {
      let ceoInfo: CeoInfo | undefined;
      if (ceoEnricher && raw.companyName) {
        ceoInfo = await ceoEnricher.getCeoInfo(raw.companyName, raw.companyUrl);
      }

      normalized.push(normalizeRawJob(raw, ceoInfo, now));
    } catch (err) {
      if (onValidationError) {
        onValidationError(
          raw,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  return normalized;
}
