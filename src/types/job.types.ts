/**
 * Source discovery config (Phase 1).
 * Canonical Job / RawJob types.
 */

export type AdapterKind =
  | "getro"
  | "consider"
  | "climatebase"
  | "inclimate"
  | "generic-html"
  | "large-aggregator";

export type PlatformKind = "getro" | "inclimate" | "custom";

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

/** Never scrape LinkedIn job pages. */
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
 * Raw job payload as extracted by platform adapters before normalization and enrichment.
 */
export type RawJob = {
  source: string;
  jobTitle: string;
  jobUrl: string;
  companyName?: string | undefined;
  companyUrl?: string | undefined;
  locationRaw?: string | undefined;
  isRemote?: boolean | undefined;
  salaryRaw?: string | undefined;
  postedAtRaw?: string | undefined;
  jobDesc?: string | undefined;
  applyUrl?: string | undefined;
};

/**
 * Enriched CEO data returned by the CEO enricher.
 */
export type CeoInfo = {
  ceo_name: string;
  ceo_source_url: string;
  ceo_confidence: "High" | "Medium" | "Low" | "N/A";
  company_url?: string | undefined;
};

/**
 * Canonical Job record corresponding 1:1 with business CSV columns:
 * Company Name, Job Title, Job Description, Job Appy Url, Company Url,
 * Location, Date Posted, Scourse Board, Unique Key, Ceo Name,
 * Ceo Source Url, Ceo Confidence, Date Scraped, Seniority, JOb of interest
 */
export type Job = {
  company_name: string;
  job_title: string;
  job_desc: string;
  job_apply_url: string;
  company_url: string;
  location: string;
  date_posted: string | null;
  source_board: string;
  unique_key: string;
  ceo_name: string;
  ceo_source_url: string;
  ceo_confidence: string;
  date_scraped: string;
  seniority: string;
  job_of_interest: string;
  // Lifecycle tracking
  first_seen_at?: string | undefined;
  last_seen_at?: string | undefined;
  is_active?: boolean | undefined;
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
   */
  scrapedSourceIds?: string[] | undefined;
  now?: Date | undefined;
};
