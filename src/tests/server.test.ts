import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ScraperServer } from "../server/server.js";
import { CsvStorage } from "../storage/csv-storage.js";
import { BrowserManager } from "../browser/browser-manager.js";
import { Logger } from "../pipeline/logger.js";
import type { IJobAdapter } from "../adapters/base.adapter.js";
import type { RawJob, SourceConfig, AdapterKind } from "../types/job.types.js";

class MockTestAdapter implements IJobAdapter {
  readonly adapterId: AdapterKind = "getro";
  async scrape(_source: SourceConfig): Promise<RawJob[]> {
    return [
      {
        source: "test-source",
        jobTitle: "Senior Climate Engineer",
        jobUrl: "https://example.com/job/1",
        companyName: "Acme Solar",
        locationRaw: "San Francisco, CA",
        isRemote: false,
      },
    ];
  }
}

describe("ScraperServer HTTP API & CSV Download", () => {
  const testDir = path.resolve(process.cwd(), "data", "test_server");
  const testCsvPath = path.join(testDir, "jobs.csv");
  let server: ScraperServer;
  let serverPort: number;
  let browserManager: BrowserManager;

  before(async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const storage = new CsvStorage(testCsvPath);
    // Seed test CSV with one existing job
    await storage.save([
      {
        company_name: "Seed Energy",
        job_title: "Solar Analyst",
        job_desc: "Analyze solar metrics",
        job_apply_url: "https://example.com/seed",
        company_url: "https://seedenergy.com",
        location: "Remote",
        date_posted: "2026-09-01",
        source_board: "test-source",
        unique_key: "seed-energy:::solar-analyst:::remote",
        ceo_name: "Jane Doe",
        ceo_source_url: "https://example.com",
        ceo_confidence: "High",
        date_scraped: new Date().toISOString(),
        seniority: "Mid-Level",
        job_of_interest: "Yes",
      },
    ]);

    const mockSource: SourceConfig = {
      id: "test-source",
      displayName: "Test Source",
      url: "https://example.com",
      adapter: "getro",
      platform: "getro",
      pagination: "load_more",
      jsonApi: { status: "none", notes: "" },
      viewJob: "on_site",
      jobDescPolicy: "board_or_ats",
      robots: { url: "https://example.com/robots.txt", listingAllowed: true, notes: "" },
      enabled: true,
      concurrencyGroup: "default",
      notes: "",
    };

    const adapters = new Map<AdapterKind, IJobAdapter>([
      ["getro", new MockTestAdapter()],
    ]);

    browserManager = new BrowserManager({ headless: true });
    const logger = new Logger({ level: "error" });

    server = new ScraperServer({
      port: 0, // OS assigns available ephemeral port
      sources: [mockSource],
      adapters,
      storage,
      browserManager,
      logger,
    });

    serverPort = await server.start();
  });

  after(async () => {
    await server.stop();
    await browserManager.close();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("GET /health should return 200 with server status", async () => {
    const res = await fetch(`http://localhost:${serverPort}/health`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json");

    const data = (await res.json()) as { status: string; totalTrackedJobs: number };
    assert.equal(data.status, "healthy");
    assert.equal(data.totalTrackedJobs >= 1, true);
  });

  it("GET /api/jobs/download should stream existing CSV as attachment", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/jobs/download`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="jobs.csv"',
    );

    const csvText = await res.text();
    assert.equal(csvText.includes("Company Name"), true);
    assert.equal(csvText.includes("Seed Energy"), true);
  });

  it("POST /api/scrape/download should execute scraper and stream updated CSV", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/scrape/download?dryRun=true`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      res.headers.get("content-disposition"),
      'attachment; filename="jobs.csv"',
    );

    const csvText = await res.text();
    assert.equal(csvText.includes("Company Name"), true);
    assert.equal(csvText.includes("Seniority"), true);
    assert.equal(csvText.includes("JOb of interest"), true);
  });

  it("POST /api/scrape should execute scraper and return JSON summary", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/scrape?dryRun=true`, {
      method: "POST",
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { status: string; downloadUrl: string };
    assert.equal(data.status, "success");
    assert.equal(data.downloadUrl, "/api/jobs/download");
  });

  it("GET /non-existent should return 404 with helpful guidance", async () => {
    const res = await fetch(`http://localhost:${serverPort}/non-existent`);
    assert.equal(res.status, 404);
    const data = (await res.json()) as { error: string };
    assert.equal(data.error, "Not Found");
  });
});
