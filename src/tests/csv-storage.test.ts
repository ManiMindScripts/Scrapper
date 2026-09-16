import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CsvStorage, CANONICAL_CSV_COLUMNS } from "../storage/csv-storage.js";
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

  await t.test("initial run: saves new jobs with first_seen_at and last_seen_at equal", async () => {
    const freshJobs = [
      normalizeRawJob(initialRaw1, t0),
      normalizeRawJob(initialRaw2, t0),
      normalizeRawJob(initialRaw3, t0),
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

    // Verify CSV file exists and contains canonical headers
    const fileContent = fs.readFileSync(testCsvPath, "utf-8");
    const headerLine = fileContent.split(/\r?\n/)[0];
    assert.equal(headerLine, CANONICAL_CSV_COLUMNS.join(","));

    // Verify fields of first job
    const job1 = loaded.find((j) => j.job_url === initialRaw1.jobUrl);
    assert.ok(job1);
    assert.equal(job1.company_name, "Acme Climate");
    assert.equal(job1.is_remote, true);
    assert.equal(job1.salary_min, 140000);
    assert.equal(job1.salary_max, 180000);
    assert.equal(job1.salary_currency, "USD");
    assert.equal(job1.first_seen_at, t0.toISOString());
    assert.equal(job1.last_seen_at, t0.toISOString());
    assert.equal(job1.is_active, true);
  });

  const t1 = new Date("2026-09-02T12:00:00.000Z");

  await t.test("subsequent run: updates last_seen_at, preserves first_seen_at, updates mutable fields", async () => {
    // Job 1 is seen again with updated salary
    const updatedRaw1: RawJob = {
      ...initialRaw1,
      salaryRaw: "$150,000 - $190,000",
    };

    // Job 2 is omitted (closed on khosla-ventures)
    // Job 4 is a brand new job on khosla-ventures
    const newRaw4: RawJob = {
      source: "khosla-ventures",
      jobTitle: "VP of Engineering",
      jobUrl: "https://jobs.lever.co/company/999",
      companyName: "Acme Climate",
      locationRaw: "San Francisco, CA",
      isRemote: false,
      postedAtRaw: "2026-09-01T00:00:00.000Z",
    };

    // Note: 'rubio' source was NOT scraped in this run (e.g. only khosla was run)
    const freshBatch: Job[] = [
      normalizeRawJob(updatedRaw1, t1),
      normalizeRawJob(newRaw4, t1),
    ];

    const result = await storage.save(freshBatch, {
      scrapedSourceIds: ["khosla-ventures"],
      now: t1,
    });

    assert.equal(result.newJobs, 1);
    assert.equal(result.updatedJobs, 1);
    assert.equal(result.deactivatedJobs, 1); // job2 from khosla deactivated
    assert.equal(result.totalRows, 4); // 3 original + 1 new = 4 total

    const loaded = await storage.loadExisting();
    assert.equal(loaded.length, 4);

    // Verify job 1: updated last_seen_at, original first_seen_at, new salary
    const job1 = loaded.find((j) => j.job_url === initialRaw1.jobUrl);
    assert.ok(job1);
    assert.equal(job1.first_seen_at, t0.toISOString());
    assert.equal(job1.last_seen_at, t1.toISOString());
    assert.equal(job1.salary_min, 150000);
    assert.equal(job1.salary_max, 190000);
    assert.equal(job1.is_active, true);

    // Verify job 2: marked inactive because it was omitted from khosla-ventures
    const job2 = loaded.find((j) => j.job_url === initialRaw2.jobUrl);
    assert.ok(job2);
    assert.equal(job2.is_active, false);
    assert.equal(job2.first_seen_at, t0.toISOString());
    assert.equal(job2.last_seen_at, t0.toISOString());

    // Verify job 3: from rubio (not scraped this run), MUST STILL BE ACTIVE!
    const job3 = loaded.find((j) => j.job_url === initialRaw3.jobUrl);
    assert.ok(job3);
    assert.equal(job3.is_active, true); // Safe scoping: not touched!

    // Verify job 4: newly added
    const job4 = loaded.find((j) => j.job_url === newRaw4.jobUrl);
    assert.ok(job4);
    assert.equal(job4.first_seen_at, t1.toISOString());
    assert.equal(job4.last_seen_at, t1.toISOString());
    assert.equal(job4.is_active, true);
  });

  await t.test("sorting: sorted by posted_at descending", async () => {
    const loaded = await storage.loadExisting();
    for (let i = 0; i < loaded.length - 1; i++) {
      const curr = loaded[i]!;
      const next = loaded[i + 1]!;
      const currTime = curr.posted_at ? new Date(curr.posted_at).getTime() : 0;
      const nextTime = next.posted_at ? new Date(next.posted_at).getTime() : 0;
      assert.ok(
        currTime >= nextTime,
        `Expected job ${i} (${curr.job_title}, ${curr.posted_at}) to be >= job ${i + 1} (${next.job_title}, ${next.posted_at})`,
      );
    }
  });

  // Cleanup temporary directory
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
