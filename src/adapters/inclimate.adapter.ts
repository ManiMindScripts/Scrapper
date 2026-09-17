import pLimit from "p-limit";
import type { AdapterKind, RawJob, SourceConfig } from "../types/job.types.js";
import type { IJobAdapter } from "./base.adapter.js";
import type { BrowserManager } from "../browser/browser-manager.js";

const SUPABASE_SEARCH_URL =
  "https://zebbhafpzjdsyawvhahy.supabase.co/rest/v1/rpc/search_jobs_v3";
const SUPABASE_DETAIL_URL =
  "https://zebbhafpzjdsyawvhahy.supabase.co/rest/v1/rpc/get_public_job";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplYmJoYWZwempkc3lhd3ZoYWh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxMDY5MjYsImV4cCI6MjA3MDY4MjkyNn0.QuZIlo71ML_oh8DXVJrPqAne_Mf4aBSZts_5FcR6J2k";

interface InclimateSearchItem {
  id: string;
  slug: string;
  title?: string;
  company_name?: string;
  location?: string;
  is_remote?: boolean;
  salary_minimum?: number | null;
  salary_maximum?: number | null;
  salary_currency?: string | null;
  date_posted?: string;
  created_at?: string;
  application_url?: string;
}

interface InclimatePublicJobDetail {
  id: string;
  slug: string;
  title: string;
  company_name: string;
  location: string;
  way_of_working?: string;
  salary_minimum?: number | null;
  salary_maximum?: number | null;
  salary_currency?: string | null;
  application_url?: string;
  job_description?: string;
  date_posted?: string;
}

export interface InclimateAdapterOptions {
  /** Maximum number of jobs to fetch. Defaults to 5000 (set higher for full board scrape) */
  maxJobs?: number | undefined;
  /** Concurrent requests for job details */
  concurrency?: number | undefined;
}

export class InclimateAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind = "inclimate";
  private readonly maxJobs: number;
  private readonly concurrencyLimit: number;

  constructor(options: InclimateAdapterOptions = {}) {
    this.maxJobs = options.maxJobs ?? 5000;
    this.concurrencyLimit = options.concurrency ?? 10;
  }

  async scrape(
    source: SourceConfig,
    _browserManager?: BrowserManager | undefined,
  ): Promise<RawJob[]> {
    const rawListings: InclimateSearchItem[] = [];
    let offset = 0;
    const batchSize = 100;

    while (rawListings.length < this.maxJobs) {
      const needed = this.maxJobs - rawListings.length;
      const fetchSize = Math.min(needed, batchSize);

      const batch = await this.fetchSearchPage(offset, fetchSize);
      if (!batch || batch.length === 0) {
        break;
      }

      rawListings.push(...batch);
      offset += batch.length;

      if (batch.length < fetchSize) {
        break; // Reached the end of available jobs
      }
    }

    if (rawListings.length === 0) {
      return [];
    }

    // Enrich listings with public details (descriptions, company names, direct apply URLs)
    const limit = pLimit(this.concurrencyLimit);
    const enrichedJobs = await Promise.all(
      rawListings.map((item) =>
        limit(async () => {
          const detail = await this.fetchJobDetail(item.id);
          return this.mapToRawJob(source.id, item, detail);
        }),
      ),
    );

    return enrichedJobs;
  }

  private async fetchSearchPage(
    offset: number,
    limit: number,
  ): Promise<InclimateSearchItem[]> {
    const res = await fetch(SUPABASE_SEARCH_URL, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        authorization: `Bearer ${ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_search_query: null,
        p_search_in_description: false,
        p_continent_ids: null,
        p_country_ids: null,
        p_general_background_ids: null,
        p_specific_background_ids: null,
        p_saved_only: false,
        p_user_id: null,
        p_remote_only: false,
        p_supports_visa: false,
        p_female_led: false,
        p_has_physical_solution: false,
        p_has_salary: false,
        p_experience_slugs: null,
        p_employment_slugs: null,
        p_way_of_working_slugs: null,
        p_company_type_slugs: null,
        p_company_sector_ids: null,
        p_company_sub_sector_ids: null,
        p_sort_by: "date",
        p_sort_order: "desc",
        p_limit: limit,
        p_offset: offset,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `InClimate search API returned status ${res.status}: ${res.statusText}`,
      );
    }

    return (await res.json()) as InclimateSearchItem[];
  }

  private async fetchJobDetail(
    jobId: string,
  ): Promise<InclimatePublicJobDetail | null> {
    try {
      const res = await fetch(SUPABASE_DETAIL_URL, {
        method: "POST",
        headers: {
          apikey: ANON_KEY,
          authorization: `Bearer ${ANON_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ p_job_id: jobId }),
      });

      if (res.ok) {
        const data = (await res.json()) as InclimatePublicJobDetail[];
        if (Array.isArray(data) && data.length > 0 && data[0]) {
          return data[0];
        }
      }
    } catch {
      // Graceful fallback to list-level fields
    }
    return null;
  }

  private mapToRawJob(
    sourceId: string,
    item: InclimateSearchItem,
    detail: InclimatePublicJobDetail | null,
  ): RawJob {
    const company = detail?.company_name || item.company_name || "";
    const location = detail?.location || item.location || "";
    const isRemote =
      detail?.way_of_working === "Remote" || item.is_remote === true;
    const jobUrl = `https://www.inclimate.com/jobs/${item.id}/${item.slug}`;

    const salaryMin = detail?.salary_minimum ?? item.salary_minimum ?? null;
    const salaryMax = detail?.salary_maximum ?? item.salary_maximum ?? null;
    const salaryCurrency =
      detail?.salary_currency ?? item.salary_currency ?? "";
    const salaryRaw =
      salaryMin && salaryMax
        ? `${salaryMin}-${salaryMax} ${salaryCurrency}`.trim()
        : salaryMin
          ? `${salaryMin} ${salaryCurrency}`.trim()
          : "";

    const applyUrl = detail?.application_url || item.application_url || "";
    const isLinkedIn = /linkedin\.com\/jobs\/view/i.test(applyUrl);

    const cleanDesc = isLinkedIn
      ? ""
      : (detail?.job_description || "").replace(/[\r\n]+/g, " ").slice(0, 1000);

    const postedAtRaw =
      detail?.date_posted || item.date_posted || item.created_at || "";

    return {
      source: sourceId,
      jobTitle: detail?.title || item.title || "",
      jobUrl,
      companyName: company,
      locationRaw: location,
      isRemote,
      salaryRaw,
      postedAtRaw,
      jobDesc: cleanDesc,
    };
  }
}
