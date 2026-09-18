import fs from "node:fs";
import path from "node:path";
import type { CeoInfo } from "../types/job.types.js";
import { Logger, defaultLogger } from "../pipeline/logger.js";
import { SearxngClient, isValidCeoName } from "./searxng.client.js";

export interface CeoEnricherOptions {
  searxngUrl?: string | undefined;
  cacheFilePath?: string | undefined;
  logger?: Logger | undefined;
}

export class CeoEnricher {
  private readonly searxngClient: SearxngClient;
  private readonly cacheFilePath: string;
  private readonly logger: Logger;
  private cache: Map<string, CeoInfo> = new Map();
  private isDirty = false;

  constructor(options: CeoEnricherOptions = {}) {
    this.logger = options.logger || defaultLogger;
    this.searxngClient = new SearxngClient({
      baseUrl:
        options.searxngUrl ||
        process.env.SEARXNG_URL ||
        "http://172.16.200.250:8081",
      logger: this.logger,
    });

    this.cacheFilePath =
      options.cacheFilePath ||
      path.resolve(process.cwd(), "data", "ceo_cache.json");

    this.loadCache();
  }

  private normalizeKey(company: string): string {
    return company
      .toLowerCase()
      .trim()
      .replace(/^(the|a)\s+/i, "")
      .replace(/[\.,\(\)\-\_]/g, " ")
      .replace(/\s+(inc|llc|ltd|corp|corporation|gmbh|co|holdings|group)$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const content = fs.readFileSync(this.cacheFilePath, "utf-8");
        if (content.trim()) {
          const parsed = JSON.parse(content) as Record<string, CeoInfo>;
          let validCount = 0;
          let purgedCount = 0;
          for (const [key, value] of Object.entries(parsed)) {
            // Validate that cached CEO name is valid or explicitly "N/A"
            if (value.ceo_name === "N/A" || isValidCeoName(value.ceo_name, key)) {
              this.cache.set(key, value);
              validCount++;
            } else {
              // Corrupt or invalid entry from old heuristic -> purge so it gets re-extracted
              purgedCount++;
              this.isDirty = true;
            }
          }
          if (purgedCount > 0) {
            this.saveCache();
          }
          this.logger.debug(
            `Loaded ${validCount} valid cached entries from ${this.cacheFilePath} (${purgedCount} purged)`,
            "ceo-enricher",
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load cache from ${this.cacheFilePath}: ${err instanceof Error ? err.message : String(err)}`,
        "ceo-enricher",
      );
    }
  }

  public saveCache(): void {
    if (!this.isDirty) return;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const obj: Record<string, CeoInfo> = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(obj, null, 2), "utf-8");
      this.isDirty = false;
      this.logger.debug(
        `Saved ${this.cache.size} company profiles to ${this.cacheFilePath}`,
        "ceo-enricher",
      );
    } catch (err) {
      this.logger.warn(
        `Failed to write cache to ${this.cacheFilePath}: ${err instanceof Error ? err.message : String(err)}`,
        "ceo-enricher",
      );
    }
  }

  async getCeoInfo(
    companyName: string,
    companyUrl?: string | undefined,
  ): Promise<CeoInfo> {
    if (!companyName || !companyName.trim()) {
      return {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
        company_url: companyUrl || "",
      };
    }

    const key = this.normalizeKey(companyName);

    // 1. Check local persistent cache
    if (this.cache.has(key)) {
      const cached = this.cache.get(key)!;
      if (cached.ceo_name === "N/A" || isValidCeoName(cached.ceo_name, companyName)) {
        if (!cached.company_url && companyUrl) {
          cached.company_url = companyUrl;
          this.isDirty = true;
          this.saveCache();
        }
        return cached;
      }
    }

    // 2. Query SearXNG meta-search engine
    try {
      const info = await this.searxngClient.searchCeo(
        companyName,
        companyUrl,
      );

      this.cache.set(key, info);
      this.isDirty = true;
      this.saveCache();

      return info;
    } catch (err) {
      this.logger.warn(
        `Failed to enrich company '${companyName}' via SearXNG: ${err instanceof Error ? err.message : String(err)}`,
        "ceo-enricher",
      );

      const fallback: CeoInfo = {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
        company_url: companyUrl || "",
      };
      this.cache.set(key, fallback);
      this.isDirty = true;
      return fallback;
    }
  }
}
