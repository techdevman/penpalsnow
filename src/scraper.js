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

/**
 * Fetch email for a given showemail id from the API.
 */
async function fetchEmail(id) {
  const url = `${SHOWEMAIL_API}?e=${encodeURIComponent(id)}`;
  const res = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    responseType: 'text',
    validateStatus: () => true,
  });
  const trimmed = (res.data || '').trim();
  if (trimmed.match(EMAIL_REGEX)) return trimmed;
  try {
    const json = JSON.parse(trimmed);
    if (json.email) return json.email;
    if (typeof json === 'string' && json.match(EMAIL_REGEX)) return json;
  } catch (_) {}
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

/**
 * Fetch one listing page (URL or form submit for next page).
 */
async function fetchPage(urlOrConfig) {
  const opts = { headers: DEFAULT_HEADERS, responseType: 'text', validateStatus: () => true };
  if (typeof urlOrConfig === 'string') {
    const res = await axios.get(urlOrConfig, opts);
    return { html: res.data, url: urlOrConfig };
  }
  const { url, method, params } = urlOrConfig;
  if (method === 'post') {
    const res = await axios.post(url, params.toString(), {
      headers: { ...DEFAULT_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      responseType: 'text',
      validateStatus: () => true,
    });
    return { html: res.data, url };
  }
  const getUrl = params.toString() ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
  const res = await axios.get(getUrl, opts);
  return { html: res.data, url: getUrl };
}

/**
 * Scrape one page: parse HTML for ids + ad blocks, then fetch emails from API.
 */
async function scrapeCurrentPage(html, pageUrl, options = {}) {
  const { requestDelayMs = 300 } = options;
  const adsWithIds = parsePage(html);
  const results = [];
  for (const ad of adsWithIds) {
    const email = await fetchEmail(ad.id);
    const { id, ...fields } = ad;
    results.push({ ...fields, email: email || null });
    await delay(requestDelayMs);
  }
  return results;
}

async function scrapeAllPages(country, sex, options = {}) {
  const { maxPages = 999, requestDelayMs = 300 } = options;
  const listingUrl = buildListingUrl(country, sex);
  const allAds = [];
  let pageNum = 1;
  let nextRequest = listingUrl;

  while (pageNum <= maxPages) {
    const { html } = await fetchPage(nextRequest);
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

  console.log(`Scraping: ${url}\n`);

  const ads = await scrapeAllPages(country, sex, { maxPages: 999, requestDelayMs: 300 });
  const excelPath = getExcelPath(country, sex);
  await saveToExcel(ads, excelPath);
  console.log(`\nTotal: ${ads.length} ads`);
  console.log(`Saved: ${excelPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
