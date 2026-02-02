/**
 * PenpalsNow scraper – fetch HTML, parse a.showemail.ppadvaluebold for ids,
 * get emails via GET https://www.penpalsnow.com/_api/showemail.php?e={id}
 * No Puppeteer. Pagination via form submit (Next 5 pen pal ads).
 *
 * Usage: node src/scraper.js [country] [sex]
 * Output: Excel file e.g. output/AUmale.xlsx
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as XLSX from 'xlsx';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');

const BASE = 'https://www.penpalsnow.com';
const LISTING_PATH = '/ads/sexcountry';
const SHOWEMAIL_API = `${BASE}/_api/showemail.php`;
const ADS_PER_PAGE = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function buildListingUrl(country, sex) {
  const c = (country || 'AU').toUpperCase();
  const s = (sex || 'male').toLowerCase();
  return `${BASE}${LISTING_PATH}/${c}${s}.html`;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const FETCH_EMAIL_RETRIES = 4;
const FETCH_EMAIL_TIMEOUT_MS = 15000;

/**
 * Fetch email for a given showemail id from the API. Retries on ECONNRESET / socket hang up.
 */
async function fetchEmail(id) {
  const url = `${SHOWEMAIL_API}?e=${encodeURIComponent(id)}`;
  const opts = {
    headers: DEFAULT_HEADERS,
    responseType: 'text',
    validateStatus: () => true,
    timeout: FETCH_EMAIL_TIMEOUT_MS,
  };
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_EMAIL_RETRIES; attempt++) {
    try {
      const res = await axios.get(url, opts);
      const trimmed = (res.data || '').trim();
      if (trimmed.match(EMAIL_REGEX)) return trimmed;
      try {
        const json = JSON.parse(trimmed);
        if (json.email) return json.email;
        if (typeof json === 'string' && json.match(EMAIL_REGEX)) return json;
      } catch (_) {}
      return null;
    } catch (err) {
      lastErr = err;
      const code = err.code || err.cause?.code;
      const isRetryable =
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        (err.message && /socket hang up|network/i.test(err.message));
      if (!isRetryable || attempt === FETCH_EMAIL_RETRIES) break;
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      if (attempt > 1) console.warn(`  fetchEmail ${id} attempt ${attempt} failed (${code || err.message}), retry in ${backoffMs}ms`);
      await delay(backoffMs);
    }
  }
  if (lastErr && FETCH_EMAIL_RETRIES > 1) {
    console.warn(`  fetchEmail ${id} failed after ${FETCH_EMAIL_RETRIES} attempts: ${lastErr.code || lastErr.message}`);
  }
  return null;
}

/**
 * Extract ad fields from an ad block element (cheerio).
 */
function getAdFieldsFromBlock($, block) {
  const text = $(block).text() || '';
  const getLabel = (label) => {
    const re = new RegExp(`${label}:\\s*([^\\n]+)`, 'i');
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    name: getLabel('Name'),
    gender: getLabel('Gender'),
    ageGroup: getLabel('Age Group'),
    cityCountry: getLabel('City & Country'),
    hobbies: getLabel('Hobbies'),
    message: getLabel('Penpal message') || getLabel('Penpal message / wishes'),
    lastModified: getLabel('Last modified'),
  };
}

/**
 * Parse one page HTML: get all a.showemail.ppadvaluebold ids and their ad blocks.
 */
function parsePage(html) {
  const $ = cheerio.load(html);
  const ads = [];
  const $links = $('a.showemail.ppadvaluebold');
  $links.each((i, el) => {
    if (i >= ADS_PER_PAGE) return;
    const id = $(el).attr('id');
    if (!id) return;
    const $el = $(el);
    const block = $el.closest('table').length ? $el.closest('table')[0] : $el.parent().parent()[0];
    const adFields = block ? getAdFieldsFromBlock($, block) : {};
    ads.push({ id, ...adFields });
  });
  return ads;
}

/**
 * Get form data for "Next 5 pen pal ads" if present. Returns null if no next form.
 */
function getNextFormData(html, baseUrl) {
  const $ = cheerio.load(html);
  const $form = $('input.button[type="submit"][value="Next 5 pen pal ads"]').closest('form');
  if (!$form.length) return null;
  const action = $form.attr('action') || '';
  const method = ($form.attr('method') || 'get').toLowerCase();
  const url = action.startsWith('http') ? action : new URL(action, baseUrl).href;
  const params = new URLSearchParams();
  $form.find('input').each((_, el) => {
    const name = $(el).attr('name');
    const type = $(el).attr('type');
    const val = $(el).attr('value');
    if (!name) return;
    params.set(name, val ?? '');
  });
  return { url, method, params };
}

const FETCH_PAGE_RETRIES = 4;
const FETCH_PAGE_TIMEOUT_MS = 30000;

function isRetryableNetworkError(err) {
  const code = err.code || err.cause?.code;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    (err.message && /socket hang up|network/i.test(err.message))
  );
}

/**
 * Fetch one listing page (URL or form submit for next page). Retries on ECONNRESET / socket hang up.
 */
async function fetchPage(urlOrConfig) {
  const opts = {
    headers: DEFAULT_HEADERS,
    responseType: 'text',
    validateStatus: () => true,
    timeout: FETCH_PAGE_TIMEOUT_MS,
  };
  const doGet = (url) => axios.get(url, opts);
  const doPost = (url, body) =>
    axios.post(url, body, {
      headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text',
      validateStatus: () => true,
      timeout: FETCH_PAGE_TIMEOUT_MS,
    });

  let lastErr;
  for (let attempt = 1; attempt <= FETCH_PAGE_RETRIES; attempt++) {
    try {
      if (typeof urlOrConfig === 'string') {
        const res = await doGet(urlOrConfig);
        return { html: res.data, url: urlOrConfig };
      }
      const { url, method, params } = urlOrConfig;
      const body = params.toString();
      if (method === 'post') {
        const res = await doPost(url, body);
        return { html: res.data, url };
      }
      const getUrl = body ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
      const res = await doGet(getUrl);
      return { html: res.data, url: getUrl };
    } catch (err) {
      lastErr = err;
      if (!isRetryableNetworkError(err) || attempt === FETCH_PAGE_RETRIES) throw err;
      const backoffMs = 2000 * Math.pow(2, attempt - 1);
      console.warn(`  fetchPage attempt ${attempt} failed (${err.code || err.message}), retry in ${backoffMs}ms`);
      await delay(backoffMs);
    }
  }
  throw lastErr;
}

/**
 * Scrape one page: parse HTML for ids + ad blocks, then fetch emails from API.
 */
async function scrapeCurrentPage(html, pageUrl, options = {}) {
  const { requestDelayMs = 300 } = options;
  const adsWithIds = parsePage(html);
  const results = [];
  for (const ad of adsWithIds) {
    let email = null;
    try {
      email = await fetchEmail(ad.id);
    } catch (err) {
      console.warn(`  Skipping email for ad ${ad.name} (${ad.id}): ${err.message}`);
    }
    const { id, ...fields } = ad;
    results.push({ ...fields, email: email || null });
    await delay(requestDelayMs);
  }
  return results;
}

async function scrapeAllPages(country, sex, options = {}) {
  const { maxPages = 9999, requestDelayMs = 300, existingAds = [] } = options;
  const listingUrl = buildListingUrl(country, sex);
  const allAds = [...existingAds];
  let pageNum = existingAds.length > 0 ? Math.floor(existingAds.length / ADS_PER_PAGE) + 1 : 1;
  let nextRequest = listingUrl;

  if (existingAds.length > 0) {
    console.log(`Resuming: ${existingAds.length} ads already, fast-forwarding to page ${pageNum}...`);
    let html;
    try {
      const result = await fetchPage(listingUrl);
      html = result.html;
    } catch (err) {
      console.warn(`Resume fast-forward failed (could not fetch first page): ${err.message}. Saving ${allAds.length} ads.`);
      return allAds;
    }
    {
      for (let i = 0; i < pageNum - 1; i++) {
        const nextForm = getNextFormData(html, BASE);
        if (!nextForm) break;
        try {
          const result = await fetchPage(nextForm);
          html = result.html;
        } catch (err) {
          console.warn(`Fast-forward failed at step ${i + 1}: ${err.message}. Saving ${allAds.length} ads.`);
          await saveToExcel(allAds, getExcelPath(country, sex));
          return allAds;
        }
        await delay(300);
      }
      const ads = await scrapeCurrentPage(html, listingUrl, { requestDelayMs });
      allAds.push(...ads);
      console.log(`Page ${pageNum}: ${ads.length} ads (total: ${allAds.length})`);
      const nextForm = getNextFormData(html, BASE);
      if (!nextForm) return allAds;
      nextRequest = nextForm;
      pageNum++;
    }
  }

  while (pageNum <= maxPages) {
    let html;
    try {
      const result = await fetchPage(nextRequest);
      html = result.html;
    } catch (err) {
      console.warn(`Page ${pageNum} fetch failed after retries: ${err.message}. Saving ${allAds.length} ads so far.`);
      break;
    }
    await delay(400);
    const ads = await scrapeCurrentPage(html, listingUrl, { requestDelayMs });
    allAds.push(...ads);
    console.log(`Page ${pageNum}: ${ads.length} ads (total: ${allAds.length})`);
    if (ads.length === 0) break;

    const nextForm = getNextFormData(html, BASE);
    if (!nextForm) break;
    nextRequest = nextForm;
    pageNum++;
  }

  return allAds;
}

function getExcelPath(country, sex) {
  const c = (country || 'AU').toUpperCase();
  const s = (sex || 'male').toLowerCase();
  return join(OUTPUT_DIR, `${c}${s}.xlsx`);
}

/**
 * Load existing ads from Excel file if it exists. Returns [] if file missing or empty.
 */
function loadExistingAds(filePath) {
  if (!existsSync(filePath)) return [];
  try {
    const wb = XLSX.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    const rows = XLSX.utils.sheet_to_json(ws);
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function saveToExcel(ads, filePath) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const ws = XLSX.utils.json_to_sheet(ads);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Penpals');
  XLSX.writeFile(wb, filePath);
}

async function main() {
  const country = process.argv[2] || 'AU';
  const sex = process.argv[3] || 'male';
  const url = buildListingUrl(country, sex);
  const excelPath = getExcelPath(country, sex);
  const existingAds = loadExistingAds(excelPath);

  console.log(`Scraping: ${url}\n`);
  if (existingAds.length > 0) {
    console.log(`Found existing file: ${existingAds.length} ads. Resuming from next page.\n`);
  }

  const ads = await scrapeAllPages(country, sex, {
    maxPages: 9999,
    requestDelayMs: 300,
    existingAds,
  });
  await saveToExcel(ads, excelPath);
  console.log(`\nTotal: ${ads.length} ads`);
  console.log(`Saved: ${excelPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
