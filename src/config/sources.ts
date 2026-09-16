import type { SourceConfig } from "../types/job.types.js";

const GETRO_OFFICIAL_API_NOTE =
  "Official api.getro.com/v2 needs a per-network Bearer key — not usable. No public unauthenticated JSON listing found. Phase 3: Playwright Load more DOM scrape.";

function getroSource(
  id: string,
  displayName: string,
  url: string,
  robots: SourceConfig["robots"],
  extraNotes: string,
): SourceConfig {
  return {
    id,
    displayName,
    url,
    adapter: "getro",
    platform: "getro",
    pagination: "load_more",
    jsonApi: {
      status: "authenticated_official",
      url: "https://api.getro.com/v2/networks/:id/jobs",
      notes: GETRO_OFFICIAL_API_NOTE,
    },
    viewJob: "mixed",
    jobDescPolicy: "board_or_ats",
    robots,
    enabled: true,
    concurrencyGroup: "default",
    notes: extraNotes,
  };
}

function considerSource(
  id: string,
  displayName: string,
  url: string,
  robots: SourceConfig["robots"],
  extraNotes: string,
): SourceConfig {
  return {
    id,
    displayName,
    url,
    adapter: "consider",
    platform: "custom",
    pagination: "unknown",
    jsonApi: {
      status: "candidate",
      url: `${new URL(url).origin}/api-boards/search-jobs`,
      notes:
        "Not Getro. Powered by Consider (consider.com). Official boards.considerapi.com/v0 needs an API key. Public board XHR is documented as POST /api-boards/search-jobs after GET /jobs (session cookie + csrfToken from page HTML). Not called in Phase 1. Phase 4: try that handshake before DOM scraping.",
    },
    viewJob: "mixed",
    jobDescPolicy: "board_or_ats",
    robots,
    enabled: true,
    concurrencyGroup: "default",
    notes: extraNotes,
  };
}

const considerRobotsAllow: SourceConfig["robots"] = {
  url: "",
  listingAllowed: true,
  notes:
    "User-agent * Allow: /. LinkedInBot Disallow: /. No /jobs disallow.",
};

export const sources: SourceConfig[] = [
  getroSource(
    "rubio",
    "Rubio",
    "https://rubio.getro.com/jobs",
    {
      url: "https://rubio.getro.com/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro: cdn.getro.com, __NEXT_DATA__, Load more, Powered by Getro. View job mixes on-site Getro pages and ATS (Greenhouse, Lever, Recruitee).",
  ),
  getroSource(
    "khosla-ventures",
    "Khosla Ventures",
    "https://jobs.khoslaventures.com/jobs",
    {
      url: "https://jobs.khoslaventures.com/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro. Load more. Apply links include Greenhouse, Ashby, Lever, and some LinkedIn URLs in markup — jobDescPolicy stays board_or_ats; skip LinkedIn if a card apply URL is linkedin.com/jobs/view.",
  ),
  getroSource(
    "dcvc",
    "DCVC",
    "https://jobs.dcvc.com/jobs",
    {
      url: "https://jobs.dcvc.com/robots.txt",
      listingAllowed: true,
      notes: "User-agent * Allow: /. Crawl-delay: 1. Sitemap present. Listed twice in plan.md — single config row.",
    },
    "Confirmed Getro. Load more. Honor crawl-delay 1 in Phase 3.",
  ),
  getroSource(
    "overture",
    "Overture",
    "https://jobs.overture.vc/jobs",
    {
      url: "https://jobs.overture.vc/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro. Load more.",
  ),
  considerSource(
    "myriad-ventures",
    "Myriad Venture Partners",
    "https://jobs.myriadventures.com/jobs",
    {
      ...considerRobotsAllow,
      url: "https://jobs.myriadventures.com/robots.txt",
    },
    "Was listed as likely Getro. HTML is Consider: Powered by Consider, consider.com assets, window.serverInitialData.fixedBoard=myriad-venture-partners. Do not use the Getro adapter.",
  ),
  getroSource(
    "astanor",
    "Astanor",
    "https://jobs.astanor.com/jobs",
    {
      url: "https://jobs.astanor.com/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro. Load more.",
  ),
  considerSource(
    "at-one-ventures",
    "At One Ventures",
    "https://jobs.atoneventures.com/jobs",
    {
      ...considerRobotsAllow,
      url: "https://jobs.atoneventures.com/robots.txt",
    },
    "Was listed as likely Getro. HTML is Consider (fixedBoard=at-one-ventures). Do not use the Getro adapter.",
  ),
  getroSource(
    "g2vp",
    "G2 Venture Partners",
    "https://jobs.g2vp.com/jobs",
    {
      url: "https://jobs.g2vp.com/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro. Load more.",
  ),
  getroSource(
    "sandbox-industries",
    "Sandbox Industries",
    "https://jobs.sandboxindustries.com/jobs",
    {
      url: "https://jobs.sandboxindustries.com/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro (__NEXT_DATA__, cdn.getro.com).",
  ),
  considerSource(
    "voyager-vc",
    "Voyager Ventures",
    "https://careers.voyagervc.com/jobs",
    {
      ...considerRobotsAllow,
      url: "https://careers.voyagervc.com/robots.txt",
    },
    "Was listed as likely Getro. HTML is Consider (fixedBoard=voyager-ventures). Do not use the Getro adapter.",
  ),
  considerSource(
    "sosv",
    "SOSV",
    "https://techjobs.sosv.com/jobs",
    {
      ...considerRobotsAllow,
      url: "https://techjobs.sosv.com/robots.txt",
    },
    "Was listed as likely Getro. HTML is Consider (fixedBoard=sosv). Do not use the Getro adapter.",
  ),
  getroSource(
    "breakthrough-energy",
    "Breakthrough Energy Ventures",
    "https://bevjobs.breakthroughenergy.org/jobs",
    {
      url: "https://bevjobs.breakthroughenergy.org/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs.",
    },
    "Confirmed Getro. Load more.",
  ),
  getroSource(
    "the-engine",
    "The Engine",
    "https://jobs.engine.xyz/jobs",
    {
      url: "https://jobs.engine.xyz/robots.txt",
      listingAllowed: true,
      notes: "Sitemap-only file; no Disallow for /jobs. engine.xyz/robots.txt separately disallows /search, /cpresources, /vendor — not this Getro host.",
    },
    "Resolved: Getro on jobs.engine.xyz (cdn.getro.com assets, __NEXT_DATA__, Load more, title 'The Engine Job Board'). engine.xyz/careers is a Craft CMS wrapper that SSR-embeds Getro-sourced cards with numbered /careers/p2 pagination and ATS links; scrape the Getro host, not the marketing wrapper.",
  ),
  {
    id: "pale-blue-dot",
    displayName: "Pale Blue Dot",
    url: "https://paleblue.vc/jobs",
    adapter: "generic-html",
    platform: "custom",
    pagination: "unknown",
    jsonApi: {
      status: "none",
      notes: "No JSON probe completed — origin returned 429 / Cloudflare browser-verify. Do not assume a Getro frontend API.",
    },
    viewJob: "unknown",
    jobDescPolicy: "unknown",
    robots: {
      url: "https://paleblue.vc/robots.txt",
      listingAllowed: "unknown",
      notes: "robots.txt also 429 / Cloudflare challenge. Re-fetch with a real browser in Phase 4 before scraping.",
    },
    enabled: true,
    concurrencyGroup: "default",
    notes:
      "Resolved as not-confirmed-Getro. Repeated HTML/robots fetches returned 429 + Cloudflare interstitial; jobs.paleblue.vc does not resolve. Earlier public listing looked like a portfolio aggregator with department/company filters, but that is not a fingerprint. Phase 4 first step: Playwright fingerprint. If cdn.getro.com / Load more appear, change this row to adapter getro — do not write a one-off scraper first.",
  },
  {
    id: "s2g-investments",
    displayName: "S2G Investments",
    url: "https://www.s2ginvestments.com/team/careers/open-positions",
    adapter: "generic-html",
    platform: "custom",
    pagination: "page_query",
    jsonApi: {
      status: "none",
      notes:
        "Craft CMS Sprig/HTMX: pagination hits index.php/actions/sprig-core/components/render with page in hx-vals and ?page=N in the URL. HTML fragments, not a jobs JSON API.",
    },
    viewJob: "mixed",
    jobDescPolicy: "skip_linkedin",
    robots: {
      url: "https://www.s2ginvestments.com/robots.txt",
      listingAllowed: true,
      notes:
        "User-agent * Disallow: /cpresources/, /vendor/, /.env, /cache/. Careers path is allowed. GPTBot/ClaudeBot/PerplexityBot Allow: /.",
    },
    enabled: true,
    concurrencyGroup: "default",
    notes:
      "Not Getro despite LinkedIn 'Powered by Getro'. Server-rendered Craft page, numbered ?page= pagination, no Getro branding. Apply URLs mix Greenhouse, BambooHR, hrmdirect, and linkedin.com/jobs/view (also ie.linkedin.com). Store LinkedIn job_url and leave job_desc blank. Never build a LinkedIn scraper.",
  },
  {
    id: "food-impact-careers",
    displayName: "Food Impact Careers",
    url: "https://www.foodimpactcareers.com/jobs",
    adapter: "generic-html",
    platform: "custom",
    pagination: "page_query",
    jsonApi: {
      status: "candidate",
      url: "https://www.foodimpactcareers.com/jobs?page=1",
      notes:
        "JBoard. Each listing page inlines window.jobsList JSON (includes description HTML). rel=next is /jobs?page=2. RSS exists at /rss/jobs (robots Disallow: /rss/). app.jboard.io/api is the product API, not a public listing we confirmed.",
    },
    viewJob: "on_site",
    jobDescPolicy: "board_or_ats",
    robots: {
      url: "https://www.foodimpactcareers.com/robots.txt",
      listingAllowed: true,
      notes: "Disallow: /rss/ only. Crawl-delay: 1. /jobs allowed.",
    },
    enabled: true,
    concurrencyGroup: "default",
    notes:
      "Custom JBoard board. On-site detail URLs like /jobs/{id}-{slug}. Honor crawl-delay 1.",
  },
  {
    id: "flagship-pioneering",
    displayName: "Flagship Pioneering",
    url: "https://www.flagshippioneering.com/join/roles",
    adapter: "generic-html",
    platform: "custom",
    pagination: "unknown",
    jsonApi: {
      status: "candidate",
      url: "https://boards-api.greenhouse.io/v1/boards/flagshippioneeringinc/jobs",
      notes:
        "Page is Alpine.js x-data=greenhouse. Public Greenhouse board JSON returns jobs (absolute_url on boards.greenhouse.io). Prefer this API in Phase 4 over DOM. Confirm it covers ecosystem/portfolio roles vs firm-only.",
    },
    viewJob: "external_ats",
    jobDescPolicy: "board_or_ats",
    robots: {
      url: "https://www.flagshippioneering.com/robots.txt",
      listingAllowed: "unknown",
      notes: "robots.txt 404. No Disallow discovered.",
    },
    enabled: true,
    concurrencyGroup: "default",
    notes: "Custom careers UI; applications go to Greenhouse (flagshippioneeringinc).",
  },
  {
    id: "climatebase",
    displayName: "Climatebase",
    url: "https://climatebase.org/jobs",
    adapter: "climatebase",
    platform: "custom",
    pagination: "infinite_scroll",
    jsonApi: {
      status: "candidate",
      notes:
        "No standalone /api/jobs (403/404). SSR __NEXT_DATA__ embeds the first 100 jobs as JSON (objectID, salary, employer, remote_preferences). Remainder almost certainly loaded client-side — capture that XHR in Phase 4 before writing a DOM loop. jobs.climatebase.org returned 403 to this crawler.",
    },
    viewJob: "on_site",
    jobDescPolicy: "board_or_ats",
    robots: {
      url: "https://climatebase.org/robots.txt",
      listingAllowed: "unknown",
      notes: "robots.txt 403 from this User-Agent. Re-check in a browser session in Phase 4.",
    },
    enabled: true,
    concurrencyGroup: "default",
    notes:
      "Next.js SPA. Dedicated adapter. Do not use Getro or generic-html.",
  },
  {
    id: "climatetechlist",
    displayName: "ClimateTechList",
    url: "https://www.climatetechlist.com/jobs",
    adapter: "large-aggregator",
    platform: "custom",
    pagination: "newest_first_pages",
    jsonApi: {
      status: "required_missing",
      notes:
        "Hard stop: no paginated jobs JSON found. GET /api/jobs and /api/job 404. _next/data/.../jobs.json is 200 but only jobsSummaryStats (company counts), not listings. Jobs page JS chunk has no API URLs. HTML mentions an Airtable embed (airtable.com/embed/appo9WyVgYvpap792/...) which is not a public unauthenticated jobs API. Sitemaps are marketing/blog URLs, not a job feed. Do not Playwright-DOM the full board.",
    },
    viewJob: "unknown",
    jobDescPolicy: "unknown",
    robots: {
      url: "https://www.climatetechlist.com/robots.txt",
      listingAllowed: true,
      notes: "User-agent * Allow: /. Sitemaps listed. Listing is allowed; we still will not DOM-scrape at this scale without JSON.",
    },
    enabled: false,
    concurrencyGroup: "large-aggregator",
    notes:
      "Single source (plan.md listed the URL twice). UI is newest-first. If a paginated JSON/XHR endpoint is found later: enable, walk newest-first, early-exit on a job_url already in CSV with recent last_seen_at, and keep this concurrency group separate from Getro. Contact page offers data partnership.",
  },
];

export function sourceById(id: string): SourceConfig | undefined {
  return sources.find((source) => source.id === id);
}
