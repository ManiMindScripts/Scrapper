#!/usr/bin/env node
/**
 * Data Migration Tool
 * Converts existing legacy jobs.csv data into the new 15-column business schema:
 * Company Name, Job Title, Job Description, Job Appy Url, Company Url,
 * Location, Date Posted, Scourse Board, Unique Key, Ceo Name,
 * Ceo Source Url, Ceo Confidence, Date Scraped, Seniority, JOb of interest
 *
 * Usage:
 *   node scripts/migrate-jobs.mjs
 *   node scripts/migrate-jobs.mjs --with-ceo  (calls OpenAI for missing CEOs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import csvWriterPkg from 'csv-writer';

const { createObjectCsvWriter } = csvWriterPkg;

const CSV_PATH = path.resolve(process.cwd(), 'data', 'jobs.csv');
const CACHE_PATH = path.resolve(process.cwd(), 'data', 'ceo_cache.json');
const withCeoLookup = process.argv.includes('--with-ceo');

// Load environment for OpenAI key if available
let openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  const match = envContent.match(/OPENAI_API_KEY=(.+)/);
  if (match) openaiApiKey = match[1].trim();
}

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

async function queryOpenAiCeo(companyName) {
  if (!openaiApiKey || !companyName) return { ceo_name: 'N/A', ceo_source_url: '', ceo_confidence: 'N/A' };
  try {
    const prompt = `Identify the current CEO or Founder of company: "${companyName}". Return JSON with fields: "ceo_name", "ceo_source_url", "ceo_confidence" ('High'|'Medium'|'Low').`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You return verified corporate CEO information in strict JSON.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    });
    if (res.ok) {
      const data = await res.json();
      const content = JSON.parse(data.choices[0].message.content);
      return {
        ceo_name: content.ceo_name || 'N/A',
        ceo_source_url: content.ceo_source_url || '',
        ceo_confidence: content.ceo_confidence || 'Medium'
      };
    }
  } catch {}
  return { ceo_name: 'N/A', ceo_source_url: '', ceo_confidence: 'N/A' };
}

async function main() {
  console.log('='.repeat(65));
  console.log('🔄 Data Migration: Upgrading jobs.csv to 15 Business Columns');
  console.log('='.repeat(65));

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

  if (withCeoLookup && openaiApiKey) {
    console.log(`Enriching CEOs via OpenAI for missing companies...`);
    let count = 0;
    for (const comp of distinctCompanies) {
      const key = normalizeCompanyKey(comp);
      if (!ceoCache[key] || ceoCache[key].ceo_name === 'N/A') {
        count++;
        process.stdout.write(`\rEnriching CEO ${count}/${distinctCompanies.size}: ${comp}...`);
        const info = await queryOpenAiCeo(comp);
        ceoCache[key] = info;
      }
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(ceoCache, null, 2), 'utf-8');
    console.log(`\n✅ CEO cache updated!`);
  }

  const migratedRows = [];
  const seenKeys = new Set();

  for (const r of records) {
    const company = (r['Company Name'] || r['company_name'] || '').trim();
    const title = (r['Job Title'] || r['job_title'] || '').trim();
    const desc = (r['Job Description'] || r['job_desc'] || '').trim();
    const applyUrl = (r['Job Appy Url'] || r['job_url'] || '').trim();
    const compUrl = (r['Company Url'] || '').trim();
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

    const compKey = normalizeCompanyKey(company);
    const cachedCeo = ceoCache[compKey] || {};
    const ceoName = r['Ceo Name'] && r['Ceo Name'] !== 'N/A' ? r['Ceo Name'] : (cachedCeo.ceo_name || 'N/A');
    const ceoSource = r['Ceo Source Url'] || cachedCeo.ceo_source_url || '';
    const ceoConf = r['Ceo Confidence'] && r['Ceo Confidence'] !== 'N/A' ? r['Ceo Confidence'] : (cachedCeo.ceo_confidence || 'N/A');

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
      ceo_source_url: ceoSource,
      ceo_confidence: ceoConf,
      date_scraped: dateScraped,
      seniority: seniority,
      job_of_interest: jobInterest
    });
  }

  // Backup existing file
  const backupPath = `${CSV_PATH}.bak.${Date.now()}`;
  fs.copyFileSync(CSV_PATH, backupPath);
  console.log(`Backed up original file to: ${backupPath}`);

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
  console.log(`\n🎉 Successfully migrated ${migratedRows.length} unique jobs into new 15-column schema at ${CSV_PATH}!`);
}

main().catch(console.error);
