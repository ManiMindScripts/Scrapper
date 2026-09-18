import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SearxngClient, isValidCeoName } from "../enrichers/searxng.client.js";
import { CeoEnricher } from "../enrichers/ceo.enricher.js";
import { extractCompanyUrl } from "../parsers/company-url.parser.js";

describe("SearxngClient & CEO Enrichment", () => {
  const client = new SearxngClient({
    baseUrl: "http://172.16.200.250:8081",
  });

  it("should validate legitimate CEO names and reject garbage/stopword phrases", () => {
    // Valid names
    assert.equal(isValidCeoName("Badri Kothandaraman"), true);
    assert.equal(isValidCeoName("Mateo Jaramillo"), true);
    assert.equal(isValidCeoName("T.J. Rodgers"), true);
    assert.equal(isValidCeoName("Philipp Schröder"), true);
    assert.equal(isValidCeoName("David Lynch"), true);

    // Invalid / garbage phrases that should never be accepted
    assert.equal(isValidCeoName("of The Caravel"), false);
    assert.equal(isValidCeoName("at Enphase Energy"), false);
    assert.equal(isValidCeoName("and also as"), false);
    assert.equal(isValidCeoName("in April"), false);
    assert.equal(isValidCeoName("selected as one"), false);
    assert.equal(isValidCeoName("chez Le Fourgon"), false);
    assert.equal(isValidCeoName("Enphase Energy", "Enphase Energy"), false);
  });

  it("should parse CEO correctly from LinkedIn / Leadership title", () => {
    const mockHtml = `
      <article class="result">
        <h3><a href="https://www.linkedin.com/in/badri-kothandaraman">Badri Kothandaraman - President and CEO, Enphase Energy</a></h3>
        <p class="content">President and CEO, Enphase Energy · Semiconductor and Renewable Energy Leader.</p>
      </article>
    `;

    const result = client.parseCeoFromHtml(mockHtml, "Enphase Energy");
    assert.equal(result.ceo_name, "Badri Kothandaraman");
    assert.equal(result.ceo_source_url, "https://www.linkedin.com/in/badri-kothandaraman");
    assert.equal(result.ceo_confidence, "High");
  });

  it("should parse CEO correctly from sentence with unicode characters", () => {
    const mockHtml = `
      <article class="result">
        <h3><a href="https://1komma5.com/en/about/">1KOMMA5° | About Us</a></h3>
        <p class="content">Philipp Schröder is the co-founder and CEO of 1KOMMA5°.</p>
      </article>
    `;

    const result = client.parseCeoFromHtml(mockHtml, "1KOMMA5°");
    assert.equal(result.ceo_name, "Philipp Schröder");
    assert.equal(result.ceo_source_url, "https://1komma5.com/en/about/");
    assert.equal(result.ceo_confidence, "High");
  });

  it("should extract official company URL from SearXNG infobox", () => {
    const mockHtml = `
      <div class="urls">
        <ul><li class="url"><bdi><a href="https://citrine.io/" rel="noreferrer">Official website</a></bdi></li></ul>
      </div>
      <article class="result">
        <h3><a href="https://citrine.io/company">Company - Citrine Informatics</a></h3>
        <p class="content">Greg Mulholland is the CEO of Citrine Informatics.</p>
      </article>
    `;

    const result = client.parseCeoFromHtml(mockHtml, "Citrine Informatics");
    assert.equal(result.company_url, "https://citrine.io");
    assert.equal(result.ceo_name, "Greg Mulholland");
  });

  it("should extract official company URL from organic matching domain excluding directory hosts", () => {
    const mockHtml = `
      <article class="result">
        <h3><a href="https://www.linkedin.com/company/form-energy">Form Energy | LinkedIn</a></h3>
        <p class="content">Directory listing.</p>
      </article>
      <article class="result">
        <h3><a href="https://formenergy.com/about">Form Energy - Long Duration Energy Storage</a></h3>
        <p class="content">Mateo Jaramillo is CEO of Form Energy.</p>
      </article>
    `;

    const result = client.parseCeoFromHtml(mockHtml, "Form Energy");
    assert.equal(result.company_url, "https://formenergy.com");
    assert.equal(result.ceo_name, "Mateo Jaramillo");
  });

  it("extractCompanyUrl parser should strip career subdomains and resolve direct domains", () => {
    assert.equal(
      extractCompanyUrl("https://careers.enphase.com/job/123", "Enphase Energy"),
      "https://www.enphase.com",
    );
    assert.equal(
      extractCompanyUrl("https://jobs.lever.co/formenergy", "Form Energy"),
      "https://www.formenergy.com",
    );
  });

  it("should prevent cross-sentence leakage from previous sentence or bullet point", () => {
    const mockHtml = `
      <article class="result">
        <h3><a href="https://example.com/event">Smart Business Dealmakers. Danny Ellis is CEO of SkySpecs</a></h3>
        <p class="content">Event summary.</p>
      </article>
    `;

    const result = client.parseCeoFromHtml(mockHtml, "SkySpecs");
    assert.equal(result.ceo_name, "Danny Ellis");
  });

  it("should parse CEO from Chairman & CEO syntax with initials", () => {
    const mockHtml = `
      <article class="result">
        <h3><a href="https://us.sunpower.com/company/leadership">Leadership | SunPower</a></h3>
        <p class="content">Our Chairman and CEO, T.J. Rodgers, is leading SunPower into a new era.</p>
      </article>
    `;

    const result = client.parseCeoFromHtml(mockHtml, "SunPower");
    assert.equal(result.ceo_name, "T.J. Rodgers");
    assert.equal(result.ceo_confidence, "High");
  });

  it("should return N/A for empty or unparseable HTML", () => {
    const mockHtml = `<div>No search results found</div>`;
    const result = client.parseCeoFromHtml(mockHtml, "NonexistentCo");
    assert.equal(result.ceo_name, "N/A");
    assert.equal(result.ceo_source_url, "");
    assert.equal(result.ceo_confidence, "N/A");
  });

  it("CeoEnricher should handle caching, purge corrupt entries, and fallback gracefully", async () => {
    const tempCachePath = "data/test_temp_ceo_cache.json";
    // Write a cache with one valid entry and one corrupt entry
    fs.writeFileSync(
      tempCachePath,
      JSON.stringify({
        "enphase energy": {
          ceo_name: "at Enphase Energy", // Corrupt -> should be purged
          ceo_source_url: "",
          ceo_confidence: "High",
          company_url: "https://www.enphase.com",
        },
        "form energy": {
          ceo_name: "Mateo Jaramillo", // Valid -> should be preserved
          ceo_source_url: "https://formenergy.com",
          ceo_confidence: "High",
          company_url: "https://formenergy.com",
        },
      }),
      "utf-8",
    );

    const enricher = new CeoEnricher({
      cacheFilePath: tempCachePath,
    });

    // Valid entry preserved from cache
    const formEnergy = await enricher.getCeoInfo("Form Energy");
    assert.equal(formEnergy.ceo_name, "Mateo Jaramillo");
    assert.equal(formEnergy.company_url, "https://formenergy.com");

    // Empty string fallback
    const emptyResult = await enricher.getCeoInfo("");
    assert.equal(emptyResult.ceo_name, "N/A");

    // Clean up
    if (fs.existsSync(tempCachePath)) {
      fs.unlinkSync(tempCachePath);
    }
  });
});
