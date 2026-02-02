/**
 * PenpalsNow scraper – loads JS-rendered pages, clicks "show e-mail" links, scrapes emails + ad data.
 * Usage: node src/scraper.js [country] [sex]
 *   country: AU | CA | US | UK  (default: AU)
 *   sex: male | female          (default: male)
 * Output: Excel file e.g. output/AUmale.xlsx
 */

import puppeteer from 'puppeteer';
import * as XLSX from 'xlsx';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');

const BASE = 'https://www.penpalsnow.com/ads/sexcountry';
const SHOW_EMAIL_SELECTOR = 'a.showemail.ppadvaluebold';
const NEXT_BUTTON_SELECTOR = 'input.button[type="submit"][value="Next 5 pen pal ads"]';
const ADS_PER_PAGE = 5;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildUrl(country, sex) {
  const c = (country || 'AU').toUpperCase();
  const s = (sex || 'male').toLowerCase();
  return `${BASE}/${c}${s}.html`;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Click the "show email" link and wait until the element reveals an email (text or mailto href).
 */
async function revealAndGetEmail(page, linkHandle) {
  const id = await linkHandle.evaluate((el) => el.id || null);
  await linkHandle.click();
  await delay(400);

  const result = await page.evaluate((selectorId) => {
    const el = selectorId ? document.getElementById(selectorId) : document.querySelector('a.showemail.ppadvaluebold');
    if (!el) return null;
    const text = (el.textContent || '').trim();
    const href = (el.getAttribute('href') || '').trim();
    if (href.startsWith('mailto:')) return href.replace(/^mailto:/i, '').trim();
    if (text && text.includes('@') && !text.includes('Hidden')) return text;
    return null;
  }, id);

  return result;
}

/**
 * Extract ad fields from an ad block element (name, gender, age, city/country, hobbies, message).
 */
async function getAdFields(page, adBlock) {
  return await adBlock.evaluate((block) => {
    const text = block.innerText || '';
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
  });
}

/**
 * Scrape ads from the current page only (up to ADS_PER_PAGE).
 * Re-queries "show email" links before each ad so handles stay valid after DOM updates from clicks.
 */
async function scrapeCurrentPage(page, options = {}) {
  const { clickDelayMs = 500 } = options;
  const ads = [];

  for (let i = 0; i < ADS_PER_PAGE; i++) {
    const showEmailLinks = await page.$$(SHOW_EMAIL_SELECTOR);
    if (i >= showEmailLinks.length) break;
    const link = showEmailLinks[i];
    const adBlock = await link.evaluateHandle((el) => {
      let node = el.closest('table') || el.closest('div') || el.parentElement;
      while (node && !node.querySelector('a.showemail')) node = node.parentElement;
      return node ? node.closest('table') || node : el.closest('table') || el.parentElement?.parentElement;
    });
    const adFields = await getAdFields(page, adBlock);
    let email = null;
    try {
      email = await revealAndGetEmail(page, link);
      if (!email && (adFields.message || '').match(EMAIL_REGEX)) {
        const m = adFields.message.match(EMAIL_REGEX);
        if (m) email = m[0];
      }
    } catch (e) {
      console.warn(`Ad ${i + 1} (${adFields.name}): failed to reveal email – ${e.message}`);
    }
    ads.push({ ...adFields, email: email || null });
    await delay(clickDelayMs);
  }
  return ads;
}

/**
 * Returns true if the "Next 5 pen pal ads" button is present.
 */
async function hasNextButton(page) {
  const el = await page.$(NEXT_BUTTON_SELECTOR);
  return el !== null;
}

/**
 * Click "Next 5 pen pal ads" and wait for the next page to load.
 */
async function clickNext(page) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click(NEXT_BUTTON_SELECTOR),
  ]);
  await delay(800);
}

async function scrapeAllPages(page, url, options = {}) {
  const { maxPages = 999, clickDelayMs = 600 } = options;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(1500);

  const allAds = [];
  let pageNum = 1;

  while (true) {
    const ads = await scrapeCurrentPage(page, { clickDelayMs });
    allAds.push(...ads);
    console.log(`Page ${pageNum}: ${ads.length} ads (total: ${allAds.length})`);

    if (pageNum >= maxPages) break;
    const hasNext = await hasNextButton(page);
    if (!hasNext || ads.length === 0) break;

    await clickNext(page);
    pageNum++;
  }

  return allAds;
}

/**
 * Write ads to an Excel file. Filename e.g. AUmale.xlsx in output/ folder.
 */
function writeExcel(ads, country, sex) {
  const c = (country || 'AU').toUpperCase();
  const s = (sex || 'male').toLowerCase();
  const filename = `${c}${s}.xlsx`;
  return join(OUTPUT_DIR, filename);
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
  const url = buildUrl(country, sex);

  console.log(`Scraping: ${url}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    const ads = await scrapeAllPages(page, url, { maxPages: 999, clickDelayMs: 600 });
    const excelPath = writeExcel(ads, country, sex);
    await saveToExcel(ads, excelPath);
    console.log(`\nTotal: ${ads.length} ads`);
    console.log(`Saved: ${excelPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
