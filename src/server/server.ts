import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import type { SourceConfig, AdapterKind } from "../types/job.types.js";
import type { IJobAdapter } from "../adapters/base.adapter.js";
import type { CsvStorage } from "../storage/csv-storage.js";
import type { BrowserManager } from "../browser/browser-manager.js";
import type { CeoEnricher } from "../enrichers/ceo.enricher.js";
import { Logger, defaultLogger } from "../pipeline/logger.js";
import { runScraper } from "../pipeline/run-scraper.js";

export interface ScraperServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  sources: SourceConfig[];
  adapters: Map<AdapterKind, IJobAdapter>;
  storage: CsvStorage;
  browserManager: BrowserManager;
  ceoEnricher?: CeoEnricher | undefined;
  logger?: Logger | undefined;
}

export class ScraperServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly host: string;
  private readonly sources: SourceConfig[];
  private readonly adapters: Map<AdapterKind, IJobAdapter>;
  private readonly storage: CsvStorage;
  private readonly browserManager: BrowserManager;
  private readonly ceoEnricher?: CeoEnricher | undefined;
  private readonly logger: Logger;
  private isScrapingActive = false;
  private lastScrapeResult: {
    timestamp: string;
    durationMs: number;
    totalTracked: number;
    activeJobs: number;
  } | null = null;

  constructor(options: ScraperServerOptions) {
    this.port =
      options.port !== undefined
        ? options.port
        : Number(process.env.PORT) || 3000;
    this.host = options.host || "0.0.0.0";
    this.sources = options.sources;
    this.adapters = options.adapters;
    this.storage = options.storage;
    this.browserManager = options.browserManager;
    this.ceoEnricher = options.ceoEnricher;
    this.logger = options.logger || defaultLogger;
  }

  public getHttpServer(): http.Server | null {
    return this.server;
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(
            `Unhandled server error: ${err instanceof Error ? err.message : String(err)}`,
            "http-server",
          );
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Internal Server Error",
                message: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        });
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        const actualPort =
          typeof addr === "object" && addr ? addr.port : this.port;
        this.logger.info(
          `Scraper HTTP API Server listening at http://${this.host}:${actualPort}`,
          "http-server",
        );
        resolve(actualPort);
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private sendCsvFile(res: http.ServerResponse, filePath: string): void {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Not Found",
          message: "CSV file has not been generated yet.",
        }),
      );
      return;
    }

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="jobs.csv"',
      "Content-Length": stat.size,
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  }

  private async executeScrape(options: {
    sourceIds?: string[] | undefined;
    dryRun?: boolean | undefined;
  }): Promise<{
    durationMs: number;
    totalTracked: number;
    activeJobs: number;
  }> {
    const startTime = Date.now();
    this.isScrapingActive = true;

    try {
      const summary = await runScraper({
        sources: this.sources,
        adapters: this.adapters,
        storage: this.storage,
        browserManager: this.browserManager,
        ceoEnricher: this.ceoEnricher,
        logger: this.logger,
        dryRun: options.dryRun ?? false,
        sourceIds: options.sourceIds,
      });

      const existingJobs = await this.storage.loadExisting();
      const activeCount = existingJobs.filter((j) => j.is_active !== false).length;
      const durationMs = Date.now() - startTime;

      const stats = {
        timestamp: new Date().toISOString(),
        durationMs,
        totalTracked: summary.storageResult?.totalRows ?? existingJobs.length,
        activeJobs: summary.storageResult?.totalActive ?? activeCount,
      };

      this.lastScrapeResult = stats;
      return stats;
    } finally {
      this.isScrapingActive = false;
    }
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname.replace(/\/$/, "") || "/";
    const method = req.method?.toUpperCase() || "GET";

    // Set standard CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Health & Status Check
    if (pathname === "/health" || pathname === "/api/status") {
      const existingJobs = await this.storage.loadExisting();
      const activeCount = existingJobs.filter((j) => j.is_active !== false).length;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          scraperStatus: this.isScrapingActive ? "running" : "idle",
          totalTrackedJobs: existingJobs.length,
          activeJobs: activeCount,
          lastScrape: this.lastScrapeResult,
          configuredSources: this.sources.map((s) => ({
            id: s.id,
            displayName: s.displayName,
            enabled: s.enabled,
          })),
        }, null, 2),
      );
      return;
    }

    // 2. Direct CSV Download (Instant, no scrape)
    if (pathname === "/api/jobs/download" && method === "GET") {
      this.sendCsvFile(res, this.storage.getFilePath());
      return;
    }

    // 3. Trigger Scrape & Download CSV (POST or GET /api/scrape/download)
    if (pathname === "/api/scrape/download" && (method === "POST" || method === "GET")) {
      if (this.isScrapingActive) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Too Many Requests",
            message: "A scraping job is already actively running. Please wait for it to complete.",
          }),
        );
        return;
      }

      const sourceParam = parsedUrl.searchParams.get("source");
      const dryRunParam = parsedUrl.searchParams.get("dryRun") === "true";
      const sourceIds = sourceParam ? [sourceParam] : undefined;

      this.logger.info(
        `API Request received to run scraper and download CSV (source: ${sourceParam || "all"}, dryRun: ${dryRunParam})`,
        "http-server",
      );

      await this.executeScrape({ sourceIds, dryRun: dryRunParam });
      this.sendCsvFile(res, this.storage.getFilePath());
      return;
    }

    // 4. Trigger Scrape and return JSON summary (POST /api/scrape)
    if (pathname === "/api/scrape" && method === "POST") {
      if (this.isScrapingActive) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Too Many Requests",
            message: "A scraping job is already actively running. Please wait for it to complete.",
          }),
        );
        return;
      }

      const sourceParam = parsedUrl.searchParams.get("source");
      const dryRunParam = parsedUrl.searchParams.get("dryRun") === "true";
      const sourceIds = sourceParam ? [sourceParam] : undefined;

      this.logger.info(
        `API Request received to run scraper (JSON mode) (source: ${sourceParam || "all"}, dryRun: ${dryRunParam})`,
        "http-server",
      );

      const stats = await this.executeScrape({ sourceIds, dryRun: dryRunParam });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          {
            status: "success",
            message: "Scraping completed successfully.",
            stats,
            downloadUrl: "/api/jobs/download",
          },
          null,
          2,
        ),
      );
      return;
    }

    // 404 Route Not Found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Not Found",
        availableEndpoints: [
          { method: "GET/POST", path: "/api/scrape/download", desc: "Runs scraper and streams updated jobs.csv" },
          { method: "POST", path: "/api/scrape", desc: "Runs scraper and returns JSON execution summary" },
          { method: "GET", path: "/api/jobs/download", desc: "Downloads latest jobs.csv instantly" },
          { method: "GET", path: "/api/status", desc: "Returns health & scraping status" },
        ],
      }, null, 2),
    );
  }
}
