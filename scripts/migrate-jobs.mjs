#!/usr/bin/env node
/**
 * Data Migration Tool
 * Converts existing legacy jobs.csv data into the 15-column business schema:
 * Company Name, Job Title, Job Description, Job Appy Url, Company Url,
 * Location, Date Posted, Scourse Board, Unique Key, Ceo Name,
 * Ceo Source Url, Ceo Confidence, Date Scraped, Seniority, JOb of interest
 *
 * Usage:
 *   node scripts/migrate-jobs.mjs
 *   node scripts/migrate-jobs.mjs --with-ceo  (queries SearXNG at http://172.16.200.250:8081)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import csvWriterPkg from 'csv-writer';
import pLimit from 'p-limit';

const { createObjectCsvWriter } = csvWriterPkg;

const CSV_PATH = path.resolve(process.cwd(), 'data', 'jobs.csv');
const CACHE_PATH = path.resolve(process.cwd(), 'data', 'ceo_cache.json');
const SEARXNG_URL = (process.env.SEARXNG_URL || 'http://172.16.200.250:8081').replace(/\/$/, '');
const withCeoLookup = process.argv.includes('--with-ceo');

// Load CEO cache
let ceoCache = {};
if (fs.existsSync(CACHE_PATH)) {
  try {
    ceoCache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {}
}

function parseSeniority(jobTitle) {
  if (!jobTitle || !jobTitle.trim()) return 'Mid-Level';
  const title = ` ${jobTitle.toLowerCase().replace(/[^a-z0-9+#/]/g, ' ')} `;

  if (/\b(ceo|cto|cfo|coo|cpo|cmo|cro|cio|ciso|chief|founder|co founder|co-founder|president|managing partner|general partner)\b/i.test(title)) return 'C-Level / Executive';
  if (/\b(vp|v\.p\.|vice president|head of|head)\b/i.test(title)) return 'VP / Head of';
  if (/\b(director|directeur)\b/i.test(title)) return 'Director';
  if (/\b(manager|mgr|engineering manager|product manager|program manager|operations manager)\b/i.test(title)) return 'Manager';
  if (/\b(lead|tech lead|team lead|principal|staff|distinguished|fellow|architect)\b/i.test(title)) return 'Lead / Principal / Staff';
  if (/\b(senior|sr|sr\.|iii|iv|v|expert|advanced)\b/i.test(title)) return 'Senior';
  if (/\b(intern|internship|co op|co-op|apprentice|student|trainee)\b/i.test(title)) return 'Intern / Co-op';
  if (/\b(junior|jr|jr\.|entry level|entry-level|entry|associate|graduate|assistant)\b/i.test(title)) return 'Entry-Level / Junior';
  return 'Mid-Level';
}

function buildJobUniqueKey(companyName, jobTitle, locationRaw, isRemote) {
  const cleanCompany = (companyName || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const cleanTitle = (jobTitle || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const locSignature = isRemote ? 'remote' : (locationRaw || 'unspecified').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${cleanCompany}:::${cleanTitle}:::${locSignature}`;
}

function extractCompanyUrl(applyUrl, companyName) {
  if (!applyUrl && !companyName) return '';
  const urlStr = (applyUrl || '').trim();
  if (urlStr) {
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();
      if (host.includes('lever.co')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }
      if (host.includes('greenhouse.io')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const slug = parts[0] === 'embed' ? parts[1] : parts[0];
        if (slug) return `https://www.${slug.replace(/inc|corp|llc/gi, '')}.com`;
      }
      if (host.includes('ashbyhq.com')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }
      if (host.includes('pinpointhq.com')) {
        const sub = host.replace('.pinpointhq.com', '');
        return `https://www.${sub}.com`;
      }
      if (host.includes('workable.com')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts[0]) return `https://www.${parts[0]}.com`;
      }
      if (host.includes('recruitee.com')) {
        const sub = host.replace('.recruitee.com', '');
        return `https://www.${sub}.com`;
      }
      if (host.includes('bamboohr.com')) {
        const sub = host.replace('.bamboohr.com', '');
        return `https://www.${sub}.com`;
      }
      const commonAggregators = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'google.com', 'getro.com', 'climatebase.org', 'inclimate.com', 'foodimpactcareers.com'];
      if (!commonAggregators.some(agg => host.includes(agg)) && host.includes('.')) {
        const cleanHost = host.replace(/^(careers|jobs|app|talent)\./, 'www.');
        return `${parsed.protocol}//${cleanHost}`;
      }
    } catch {}
  }
  if (companyName && companyName.trim()) {
    const cleanComp = companyName.toLowerCase().trim().replace(/^(the|a)\s+/i, '').replace(/[\.,\(\)\-\_]/g, '').replace(/\s+(inc|llc|ltd|corp|corporation|gmbh|co|holdings|group)$/i, '').replace(/\s+/g, '').trim();
    if (cleanComp && cleanComp.length > 2) {
      return `https://www.${cleanComp}.com`;
    }
  }
  return '';
}

function normalizeCompanyKey(company) {
  return (company || '')
    .toLowerCase()
    .trim()
    .replace(/^(the|a)\s+/i, '')
    .replace(/[\.,\(\)\-\_]/g, ' ')
    .replace(/\s+(inc|llc|ltd|corp|corporation|gmbh|co|holdings|group)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

import { SearxngClient, isValidCeoName } from '../dist/enrichers/searxng.client.js';

const searxngClient = new SearxngClient({ baseUrl: SEARXNG_URL });

async function querySearxngCeo(companyName, companyUrl) {
  return searxngClient.searchCeo(companyName, companyUrl);
}

async function main() {
  console.log('='.repeat(65));
  console.log('🔄 Data Migration: Upgrading jobs.csv via SearXNG');
  console.log('='.repeat(65));
  console.log(`SearXNG Engine: ${SEARXNG_URL}`);

  if (!fs.existsSync(CSV_PATH)) {
    console.log(`No existing file found at ${CSV_PATH}. Nothing to migrate.`);
    return;
  }

  const rawContent = fs.readFileSync(CSV_PATH, 'utf-8');
  if (!rawContent.trim()) {
    console.log(`File at ${CSV_PATH} is empty. Nothing to migrate.`);
    return;
  }

  const records = parse(rawContent, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`Read ${records.length} existing records from ${CSV_PATH}\n`);

  const distinctCompanies = new Set();
  records.forEach(r => {
    const comp = r['Company Name'] || r['company_name'];
    if (comp) distinctCompanies.add(comp.trim());
  });
  console.log(`Found ${distinctCompanies.size} unique companies across dataset.`);

  if (withCeoLookup) {
    console.log(`Enriching CEOs via SearXNG (${SEARXNG_URL})...`);
    const limit = pLimit(5);
    let completed = 0;
    const companyList = Array.from(distinctCompanies);

    await Promise.all(
      companyList.map(comp => limit(async () => {
        const key = normalizeCompanyKey(comp);
        if (!ceoCache[key] || ceoCache[key].ceo_name === 'N/A') {
          const info = await querySearxngCeo(comp);
          ceoCache[key] = info;
        }
        completed++;
        process.stdout.write(`\rEnriching CEO ${completed}/${companyList.length}...`);
      }))
    );

    fs.writeFileSync(CACHE_PATH, JSON.stringify(ceoCache, null, 2), 'utf-8');
    console.log(`\n✅ CEO cache updated with SearXNG data!`);
  }

  const migratedRows = [];
  const seenKeys = new Set();

  for (const r of records) {
    const company = (r['Company Name'] || r['company_name'] || '').trim();
    const title = (r['Job Title'] || r['job_title'] || '').trim();
    const desc = (r['Job Description'] || r['job_desc'] || '').trim();
    const applyUrl = (r['Job Appy Url'] || r['job_url'] || '').trim();
    const key = normalizeCompanyKey(company);
    const cachedCeo = ceoCache[key] || { ceo_name: 'N/A', ceo_source_url: '', ceo_confidence: 'N/A', company_url: '' };
    const compUrl = cachedCeo.company_url || (r['Company Url'] || '').trim() || extractCompanyUrl(applyUrl, company);
    const locRaw = (r['Location'] || r['location_raw'] || '').trim();
    const isRemote = r['is_remote'] === 'true' || /remote/i.test(locRaw);
    const datePosted = (r['Date Posted'] || r['posted_at'] || '').trim();
    const sourceBoard = (r['Scourse Board'] || r['source'] || 'unknown').trim();
    const dateScraped = (r['Date Scraped'] || r['last_seen_at'] || r['first_seen_at'] || new Date().toISOString()).trim();
    const seniority = (r['Seniority'] || parseSeniority(title)).trim();
    const jobInterest = (r['JOb of interest'] || 'Yes').trim();

    const uniqueKey = r['Unique Key'] || buildJobUniqueKey(company, title, locRaw, isRemote);

    // Global Deduplication across sources
    if (seenKeys.has(uniqueKey)) {
      continue;
    }
    seenKeys.add(uniqueKey);

    let ceoName = r['Ceo Name'] || cachedCeo.ceo_name;
    let ceoSourceUrl = r['Ceo Source Url'] || cachedCeo.ceo_source_url;
    let ceoConfidence = r['Ceo Confidence'] || cachedCeo.ceo_confidence;

    // If existing CSV has a corrupted name (e.g. from old heuristics), replace with valid cached or N/A
    if (ceoName && !isValidCeoName(ceoName, company) && ceoName !== 'N/A') {
      ceoName = isValidCeoName(cachedCeo.ceo_name, company) ? cachedCeo.ceo_name : 'N/A';
      ceoSourceUrl = ceoName !== 'N/A' ? cachedCeo.ceo_source_url : '';
      ceoConfidence = ceoName !== 'N/A' ? cachedCeo.ceo_confidence : 'N/A';
    } else if (!ceoName || ceoName === 'N/A') {
      if (isValidCeoName(cachedCeo.ceo_name, company)) {
        ceoName = cachedCeo.ceo_name;
        ceoSourceUrl = cachedCeo.ceo_source_url;
        ceoConfidence = cachedCeo.ceo_confidence;
      }
    }

    migratedRows.push({
      company_name: company,
      job_title: title,
      job_desc: desc,
      job_apply_url: applyUrl,
      company_url: compUrl,
      location: locRaw,
      date_posted: datePosted,
      source_board: sourceBoard,
      unique_key: uniqueKey,
      ceo_name: ceoName,
      ceo_source_url: ceoSourceUrl,
      ceo_confidence: ceoConfidence,
      date_scraped: dateScraped,
      seniority: seniority,
      job_of_interest: jobInterest
    });
  }

  // Backup existing file
  const backupPath = `${CSV_PATH}.bak.${Date.now()}`;
  fs.copyFileSync(CSV_PATH, backupPath);

  // Write new file
  const writer = createObjectCsvWriter({
    path: CSV_PATH,
    header: [
      { id: 'company_name', title: 'Company Name' },
      { id: 'job_title', title: 'Job Title' },
      { id: 'job_desc', title: 'Job Description' },
      { id: 'job_apply_url', title: 'Job Appy Url' },
      { id: 'company_url', title: 'Company Url' },
      { id: 'location', title: 'Location' },
      { id: 'date_posted', title: 'Date Posted' },
      { id: 'source_board', title: 'Scourse Board' },
      { id: 'unique_key', title: 'Unique Key' },
      { id: 'ceo_name', title: 'Ceo Name' },
      { id: 'ceo_source_url', title: 'Ceo Source Url' },
      { id: 'ceo_confidence', title: 'Ceo Confidence' },
      { id: 'date_scraped', title: 'Date Scraped' },
      { id: 'seniority', title: 'Seniority' },
      { id: 'job_of_interest', title: 'JOb of interest' },
    ]
  });

  await writer.writeRecords(migratedRows);
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  console.log(`\n🎉 Successfully updated ${migratedRows.length} unique jobs in ${CSV_PATH}!`);
}

main().catch(console.error);
