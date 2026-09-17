#!/usr/bin/env node
/**
 * Standalone terminal scraper for inclimate.com
 * Powered by InClimate's public Supabase API
 *
 * Usage:
 *   node scripts/scrape-inclimate.mjs
 *   node scripts/scrape-inclimate.mjs --limit=50 --csv=data/inclimate.csv
 *   node scripts/scrape-inclimate.mjs --query="engineer" --remote-only
 */

import fs from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';

const SUPABASE_SEARCH_URL = 'https://zebbhafpzjdsyawvhahy.supabase.co/rest/v1/rpc/search_jobs_v3';
const SUPABASE_DETAIL_URL = 'https://zebbhafpzjdsyawvhahy.supabase.co/rest/v1/rpc/get_public_job';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplYmJoYWZwempkc3lhd3ZoYWh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxMDY5MjYsImV4cCI6MjA3MDY4MjkyNn0.QuZIlo71ML_oh8DXVJrPqAne_Mf4aBSZts_5FcR6J2k';

// Parse arguments
const args = process.argv.slice(2);
function getArg(name, defaultValue = null) {
  const prefix = `--${name}=`;
  const found = args.find(a => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return defaultValue;
}
const hasFlag = (name) => args.includes(`--${name}`);

const limitCount = parseInt(getArg('limit', '25'), 10);
const searchQuery = getArg('query', null);
const remoteOnly = hasFlag('remote-only');
const csvOutput = getArg('csv', 'data/inclimate_jobs.csv');
const jsonOutput = getArg('json', null);

async function fetchJobsPage(offset = 0, pageLimit = 50) {
  const payload = {
    p_search_query: searchQuery,
    p_search_in_description: false,
    p_continent_ids: null,
    p_country_ids: null,
    p_general_background_ids: null,
    p_specific_background_ids: null,
    p_saved_only: false,
    p_user_id: null,
    p_remote_only: remoteOnly,
    p_supports_visa: false,
    p_female_led: false,
    p_has_physical_solution: false,
    p_has_salary: false,
    p_experience_slugs: null,
    p_employment_slugs: null,
    p_way_of_working_slugs: null,
    p_company_type_slugs: null,
    p_company_sector_ids: null,
    p_company_sub_sector_ids: null,
    p_sort_by: 'date',
    p_sort_order: 'desc',
    p_limit: pageLimit,
    p_offset: offset
  };

  const res = await fetch(SUPABASE_SEARCH_URL, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'authorization': `Bearer ${ANON_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`InClimate search API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function fetchJobDetail(jobId) {
  try {
    const res = await fetch(SUPABASE_DETAIL_URL, {
      method: 'POST',
      headers: {
        'apikey': ANON_KEY,
        'authorization': `Bearer ${ANON_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ p_job_id: jobId })
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data[0];
      }
    }
  } catch {
    // fallback gracefully
  }
  return null;
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  console.log('='.repeat(65));
  console.log('⚡ InClimate Job Scraper (Terminal CLI)');
  console.log('='.repeat(65));
  console.log(`Source:     https://www.inclimate.com/jobs?matching=true`);
  console.log(`Target:     ${limitCount} jobs`);
  if (searchQuery) console.log(`Filter:     query="${searchQuery}"`);
  if (remoteOnly)  console.log(`Filter:     remote_only=true`);
  console.log(`\nFetching job listings...`);

  const rawListings = [];
  let offset = 0;
  const batchSize = Math.min(limitCount, 50);

  while (rawListings.length < limitCount) {
    const needed = limitCount - rawListings.length;
    const fetchSize = Math.min(needed, batchSize);
    const batch = await fetchJobsPage(offset, fetchSize);
    if (!batch || batch.length === 0) break;
    rawListings.push(...batch);
    offset += batch.length;
    if (batch.length < fetchSize) break;
  }

  console.log(`Found ${rawListings.length} listings. Enriching details (descriptions, company names, locations)...`);

  const concurrency = pLimit(5);
  let completed = 0;
  const enrichedRows = await Promise.all(
    rawListings.map(item => concurrency(async () => {
      const detail = await fetchJobDetail(item.id);
      completed++;
      process.stdout.write(`\r[Enriching] ${completed}/${rawListings.length} jobs fetched`);

      const company = detail?.company_name || item.company_name || '';
      const location = detail?.location || item.location || '';
      const isRemote = detail?.way_of_working === 'Remote' || item.is_remote === true;
      const jobUrl = `https://www.inclimate.com/jobs/${item.id}/${item.slug}`;

      const salaryMin = detail?.salary_minimum ?? item.salary_minimum ?? null;
      const salaryMax = detail?.salary_maximum ?? item.salary_maximum ?? null;
      const salaryCurrency = detail?.salary_currency ?? item.salary_currency ?? '';
      const salaryRaw = (salaryMin && salaryMax)
        ? `${salaryMin}-${salaryMax} ${salaryCurrency}`.trim()
        : (salaryMin ? `${salaryMin} ${salaryCurrency}`.trim() : '');

      const cleanDesc = (detail?.job_description || '')
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 1000);

      const postedAt = detail?.date_posted || item.date_posted || item.created_at || '';
      const now = new Date().toISOString();

      const jobTitle = detail?.title || item.title || '';
      const seniority = (/intern/i.test(jobTitle) ? 'Intern / Co-op' : (/junior|associate|entry/i.test(jobTitle) ? 'Entry-Level / Junior' : (/vp|vice president|head of/i.test(jobTitle) ? 'VP / Head of' : (/director/i.test(jobTitle) ? 'Director' : (/manager/i.test(jobTitle) ? 'Manager' : (/lead|principal|staff/i.test(jobTitle) ? 'Lead / Principal / Staff' : (/senior|sr/i.test(jobTitle) ? 'Senior' : 'Mid-Level')))))));
      const uniqueKey = `${(company || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${(jobTitle || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      return {
        company_name: company,
        job_title: jobTitle,
        job_desc: cleanDesc,
        job_apply_url: detail?.application_url || item.application_url || jobUrl,
        company_url: '',
        location: location,
        date_posted: postedAt,
        source_board: 'inclimate',
        unique_key: uniqueKey,
        ceo_name: 'N/A',
        ceo_source_url: '',
        ceo_confidence: 'N/A',
        date_scraped: now,
        seniority: seniority,
        job_of_interest: 'Yes'
      };
    }))
  );

  console.log('\n\n✅ Done! Previewing first 5 listings:\n');
  enrichedRows.slice(0, 5).forEach((r, idx) => {
    console.log(`[${idx + 1}] ${r.job_title} (${r.seniority})`);
    console.log(`    Company:  ${r.company_name || 'N/A'}`);
    console.log(`    Location: ${r.location || 'N/A'}`);
    console.log(`    Posted:   ${r.date_posted}`);
    console.log(`    Apply:    ${r.job_apply_url}\n`);
  });

  // Save CSV
  if (csvOutput) {
    const headers = [
      'Company Name', 'Job Title', 'Job Description', 'Job Appy Url', 'Company Url',
      'Location', 'Date Posted', 'Scourse Board', 'Unique Key', 'Ceo Name',
      'Ceo Source Url', 'Ceo Confidence', 'Date Scraped', 'Seniority', 'JOb of interest'
    ];

    const keyMap = [
      'company_name', 'job_title', 'job_desc', 'job_apply_url', 'company_url',
      'location', 'date_posted', 'source_board', 'unique_key', 'ceo_name',
      'ceo_source_url', 'ceo_confidence', 'date_scraped', 'seniority', 'job_of_interest'
    ];

    const csvLines = [
      headers.join(','),
      ...enrichedRows.map(r => keyMap.map(k => escapeCsv(r[k])).join(','))
    ];

    const outDir = path.dirname(csvOutput);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(csvOutput, csvLines.join('\n'), 'utf8');
    console.log(`📁 Saved ${enrichedRows.length} canonical jobs to CSV: ${csvOutput}`);
  }

  // Save JSON if requested
  if (jsonOutput) {
    const outDir = path.dirname(jsonOutput);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(jsonOutput, JSON.stringify(enrichedRows, null, 2), 'utf8');
    console.log(`📁 Saved ${enrichedRows.length} jobs to JSON: ${jsonOutput}`);
  }
}

main().catch(err => {
  console.error('\nScraper error:', err);
  process.exit(1);
});
