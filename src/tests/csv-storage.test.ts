import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CsvStorage, CSV_FIELD_MAPPINGS } from "../storage/csv-storage.js";
import { normalizeRawJob } from "../normalizer/job.normalizer.js";
import type { Job, RawJob } from "../types/job.types.js";

test("CsvStorage — read-merge-write deduplication, deactivation, and persistence", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "job-scraper-test-"));
  const testCsvPath = path.join(tmpDir, "test-jobs.csv");
  const storage = new CsvStorage(testCsvPath);

  await t.test("loads empty list when CSV does not exist", async () => {
    const existing = await storage.loadExisting();
    assert.deepEqual(existing, []);
  });

  const t0 = new Date("2026-09-01T10:00:00.000Z");

  const initialRaw1: RawJob = {
    source: "khosla-ventures",
    jobTitle: "Founding Engineer",
    jobUrl: "https://jobs.lever.co/company/123",
    companyName: "Acme Climate",
    locationRaw: "San Francisco, CA",
    isRemote: true,
    salaryRaw: "$140,000 - $180,000",
    postedAtRaw: "2026-08-30T00:00:00.000Z",
    jobDesc: "Build green infrastructure",
  };

  const initialRaw2: RawJob = {
    source: "khosla-ventures",
    jobTitle: "Product Designer",
    jobUrl: "https://jobs.ashbyhq.com/company/456",
    companyName: "Acme Climate",
    locationRaw: "Remote",
    isRemote: true,
    salaryRaw: "$110k - $140k",
    postedAtRaw: "2026-08-25T00:00:00.000Z",
    jobDesc: "Design UI",
  };

  const initialRaw3: RawJob = {
    source: "rubio",
    jobTitle: "Investment Associate",
    jobUrl: "https://rubio.getro.com/jobs/789",
    companyName: "Rubio VC",
    locationRaw: "Amsterdam",
    isRemote: false,
    postedAtRaw: "2026-08-28T00:00:00.000Z",
  };

  await t.test("initial run: saves new jobs with 15 business columns", async () => {
    const freshJobs = [
      normalizeRawJob(initialRaw1, undefined, t0),
      normalizeRawJob(initialRaw2, undefined, t0),
      normalizeRawJob(initialRaw3, undefined, t0),
    ];

    const result = await storage.save(freshJobs, {
      scrapedSourceIds: ["khosla-ventures", "rubio"],
      now: t0,
    });

    assert.equal(result.totalRows, 3);
    assert.equal(result.newJobs, 3);
    assert.equal(result.updatedJobs, 0);
    assert.equal(result.deactivatedJobs, 0);

    const loaded = await storage.loadExisting();
    assert.equal(loaded.length, 3);

    // Verify CSV file exists and contains new 15 business headers
    const fileContent = fs.readFileSync(testCsvPath, "utf-8");
    const headerLine = fileContent.split(/\r?\n/)[0];
    const expectedHeaders = CSV_FIELD_MAPPINGS.map((m) => m.title).join(",");
    assert.equal(headerLine, expectedHeaders);

    // Verify fields of first job
    const job1 = loaded.find((j) => j.job_apply_url === initialRaw1.jobUrl);
    assert.ok(job1);
    assert.equal(job1.company_name, "Acme Climate");
    assert.equal(job1.job_title, "Founding Engineer");
    assert.equal(job1.seniority, "C-Level / Executive");
    assert.ok(job1.unique_key.includes("acme-climate:::founding-engineer"));
    assert.equal(job1.source_board, "khosla-ventures");
    assert.equal(job1.is_active, true);
  });

  const t1 = new Date("2026-09-02T12:00:00.000Z");

  await t.test("subsequent run: updates last_seen_at and handles deduplication", async () => {
    const updatedRaw1: RawJob = {
      ...initialRaw1,
      jobDesc: "Build scalable green energy infra with top team",
    };

    const newRaw4: RawJob = {
      source: "khosla-ventures",
      jobTitle: "VP of Engineering",
      jobUrl: "https://jobs.lever.co/company/999",
      companyName: "Acme Climate",
      locationRaw: "San Francisco, CA",
      isRemote: false,
      postedAtRaw: "2026-09-01T00:00:00.000Z",
    };

    const freshBatch: Job[] = [
      normalizeRawJob(updatedRaw1, undefined, t1),
      normalizeRawJob(newRaw4, undefined, t1),
    ];

    const result = await storage.save(freshBatch, {
      scrapedSourceIds: ["khosla-ventures"],
      now: t1,
    });

    assert.equal(result.newJobs, 1);
    assert.equal(result.updatedJobs, 1);
    assert.equal(result.deactivatedJobs, 1); // job2 from khosla deactivated
    assert.equal(result.totalRows, 4);

    const loaded = await storage.loadExisting();
    assert.equal(loaded.length, 4);

    const job1 = loaded.find((j) => j.job_apply_url === initialRaw1.jobUrl);
    assert.ok(job1);
    assert.equal(job1.job_desc, "Build scalable green energy infra with top team");

    const job4 = loaded.find((j) => j.job_apply_url === newRaw4.jobUrl);
    assert.ok(job4);
    assert.equal(job4.seniority, "VP / Head of");
  });

  // Cleanup temporary directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
