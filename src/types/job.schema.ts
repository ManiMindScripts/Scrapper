import { z } from "zod";
import type { Job } from "./job.types.js";

export const JobSchema = z.object({
  source: z.string().min(1, "source cannot be empty"),
  job_title: z.string().min(1, "job_title cannot be empty"),
  job_url: z.string().min(1, "job_url cannot be empty"),
  company_name: z.string(),
  location_raw: z.string(),
  is_remote: z.boolean(),
  salary_raw: z.string(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  posted_at: z.string().nullable(),
  job_desc: z.string(),
  first_seen_at: z.string().min(1, "first_seen_at cannot be empty"),
  last_seen_at: z.string().min(1, "last_seen_at cannot be empty"),
  is_active: z.boolean(),
}) satisfies z.ZodType<Job>;

export type JobSchemaType = z.infer<typeof JobSchema>;
