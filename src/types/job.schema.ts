import { z } from "zod";
import type { Job } from "./job.types.js";

export const JobSchema = z.object({
  company_name: z.string(),
  job_title: z.string().min(1, "job_title cannot be empty"),
  job_desc: z.string(),
  job_apply_url: z.string().min(1, "job_apply_url cannot be empty"),
  company_url: z.string(),
  location: z.string(),
  date_posted: z.string().nullable(),
  source_board: z.string().min(1, "source_board cannot be empty"),
  unique_key: z.string().min(1, "unique_key cannot be empty"),
  ceo_name: z.string(),
  ceo_source_url: z.string(),
  ceo_confidence: z.string(),
  date_scraped: z.string().min(1, "date_scraped cannot be empty"),
  seniority: z.string(),
  job_of_interest: z.string(),
  first_seen_at: z.string().optional(),
  last_seen_at: z.string().optional(),
  is_active: z.boolean().optional(),
}) satisfies z.ZodType<Job>;

export type JobSchemaType = z.infer<typeof JobSchema>;
