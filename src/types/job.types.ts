/**
 * Source discovery config (Phase 1).
 * Canonical Job / RawJob types land in Phase 2.
 */

export type AdapterKind =
  | "getro"
  | "consider"
  | "climatebase"
  | "generic-html"
  | "large-aggregator";

export type PlatformKind = "getro" | "custom";

export type PaginationKind =
  | "load_more"
  | "page_query"
  | "infinite_scroll"
  | "newest_first_pages"
  | "unknown";

export type JsonApiStatus =
  | "none"
  | "authenticated_official"
  | "candidate"
  | "required_missing";

export type JsonApiNote = {
  status: JsonApiStatus;
  url?: string | undefined;
  notes: string;
};

export type ViewJobKind = "on_site" | "external_ats" | "mixed" | "unknown";

/** Phase 4 reads this. Never scrape LinkedIn job pages. */
export type JobDescPolicy = "board_or_ats" | "skip_linkedin" | "unknown";

export type RobotsNote = {
  url: string;
  listingAllowed: boolean | "unknown";
  notes: string;
};

export type ConcurrencyGroup = "default" | "large-aggregator";

export type SourceConfig = {
  id: string;
  displayName: string;
  url: string;
  adapter: AdapterKind;
  platform: PlatformKind;
  pagination: PaginationKind;
  jsonApi: JsonApiNote;
  viewJob: ViewJobKind;
  jobDescPolicy: JobDescPolicy;
  robots: RobotsNote;
  enabled: boolean;
  concurrencyGroup: ConcurrencyGroup;
  notes: string;
};

/**
 * Raw job payload as extracted by platform adapters before normalization.
 */
export type RawJob = {
  source: string;
  jobTitle: string;
  jobUrl: string;
  companyName?: string | undefined;
  locationRaw?: string | undefined;
  isRemote?: boolean | undefined;
  salaryRaw?: string | undefined;
  postedAtRaw?: string | undefined;
  jobDesc?: string | undefined;
};

/**
 * Canonical Job record corresponding 1:1 with data/jobs.csv columns:
 * source, job_title, job_url, company_name, location_raw, is_remote,
 * salary_raw, salary_min, salary_max, salary_currency, posted_at,
 * job_desc, first_seen_at, last_seen_at, is_active
 */
export type Job = {
  source: string;
  job_title: string;
  job_url: string;
  company_name: string;
  location_raw: string;
  is_remote: boolean;
  salary_raw: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  job_desc: string;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
};

export type StorageSaveResult = {
  totalRows: number;
  totalActive: number;
  newJobs: number;
  updatedJobs: number;
  deactivatedJobs: number;
  alreadyInactive: number;
};

export type SaveOptions = {
  /**
   * IDs of sources that were successfully scraped in this run.
   * Jobs belonging to these sources that are absent in the fresh batch
   * will be marked is_active = false.
   * Existing jobs belonging to skipped/failed sources are NOT deactivated.
   */
  scrapedSourceIds?: string[] | undefined;
  now?: Date | undefined;
};
