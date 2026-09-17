import fs from "node:fs";
import path from "node:path";
import type { CeoInfo } from "../types/job.types.js";
import { Logger, defaultLogger } from "../pipeline/logger.js";

export interface CeoEnricherOptions {
  apiKey?: string | undefined;
  cacheFilePath?: string | undefined;
  model?: string | undefined;
  logger?: Logger | undefined;
}

export class CeoEnricher {
  private readonly apiKey: string | undefined;
  private readonly cacheFilePath: string;
  private readonly model: string;
  private readonly logger: Logger;
  private cache: Map<string, CeoInfo> = new Map();
  private isDirty = false;

  constructor(options: CeoEnricherOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || undefined;
    this.cacheFilePath =
      options.cacheFilePath ||
      path.resolve(process.cwd(), "data", "ceo_cache.json");
    this.model = options.model || "gpt-4o-mini";
    this.logger = options.logger || defaultLogger;

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
          for (const [key, value] of Object.entries(parsed)) {
            this.cache.set(key, value);
          }
          this.logger.debug(
            `Loaded ${this.cache.size} cached CEO entries from ${this.cacheFilePath}`,
            "ceo-enricher",
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load CEO cache from ${this.cacheFilePath}: ${err instanceof Error ? err.message : String(err)}`,
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
        `Saved ${this.cache.size} CEO entries to ${this.cacheFilePath}`,
        "ceo-enricher",
      );
    } catch (err) {
      this.logger.warn(
        `Failed to write CEO cache to ${this.cacheFilePath}: ${err instanceof Error ? err.message : String(err)}`,
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
      };
    }

    const key = this.normalizeKey(companyName);

    // 1. Check local persistent cache
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // 2. If no OpenAI key configured, return fallback
    if (!this.apiKey) {
      const fallback: CeoInfo = {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
      };
      this.cache.set(key, fallback);
      this.isDirty = true;
      return fallback;
    }

    // 3. Call OpenAI gpt-4o-mini
    try {
      const prompt = `Identify the current CEO (Chief Executive Officer) or Founder of the following company:
Company Name: "${companyName}"
${companyUrl ? `Company Website: "${companyUrl}"` : ""}

Return a JSON object with exactly these fields:
{
  "ceo_name": "Full Name of current CEO (or Founder if no CEO, or 'N/A' if unknown)",
  "ceo_source_url": "URL or domain where this information is verified (e.g., company website, Wikipedia, LinkedIn, or Crunchbase)",
  "ceo_confidence": "High" | "Medium" | "Low" | "N/A"
}`;

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content:
                "You are an executive research assistant. You return accurate corporate leadership and CEO data in strictly valid JSON format.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI API error ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      const rawContent = json.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error("Empty completion from OpenAI");
      }

      const parsed = JSON.parse(rawContent) as Partial<CeoInfo>;
      const ceoInfo: CeoInfo = {
        ceo_name: parsed.ceo_name?.trim() || "N/A",
        ceo_source_url: parsed.ceo_source_url?.trim() || "",
        ceo_confidence: (["High", "Medium", "Low"].includes(
          parsed.ceo_confidence || "",
        )
          ? parsed.ceo_confidence
          : "Medium") as CeoInfo["ceo_confidence"],
      };

      this.cache.set(key, ceoInfo);
      this.isDirty = true;
      this.saveCache();

      return ceoInfo;
    } catch (err) {
      this.logger.warn(
        `Failed to enrich CEO for company '${companyName}': ${err instanceof Error ? err.message : String(err)}`,
        "ceo-enricher",
      );

      const fallback: CeoInfo = {
        ceo_name: "N/A",
        ceo_source_url: "",
        ceo_confidence: "N/A",
      };
      this.cache.set(key, fallback);
      this.isDirty = true;
      return fallback;
    }
  }
}
