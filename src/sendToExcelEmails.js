/**
 * Send emails to addresses in output Excel files via Gmail SMTP.
 * Adds/updates "sent" column after each successful send.
 * Limit: 100 emails per run.
 *
 * Usage: node src/sendToExcelEmails.js [--max 100] [--files AUmale,CAmale,...]
 * Env: GMAIL_USER, APP_PASSWORD (Gmail app password)
 */

import 'dotenv/config';
import { createRequire } from 'module';
import { readdirSync, existsSync } from 'fs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendEmailGmail } from './sendEmailGmail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_EMAILS_PER_RUN = 100;
const DELAY_BETWEEN_EMAILS_MS = 1500;

const EMAIL_BODY = `Hi, I'm Milos.
I wanted to reach out and discuss the possibility of a collaboration, a partnership between us.
I believe there's a great opportunity for us to work together in a way that's beneficial for both sides, especially in terms of growing the business and increasing revenue.
If you're open to it, I'd love to have a quick chat and share some ideas.
Looking forward to hearing your thoughts!
mail: alexisfedmartinez@gmail.com
waz: +381645666956`;

const EMAIL_SUBJECT = 'Partnership opportunity';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getExcelFiles(filterFiles) {
  if (!existsSync(OUTPUT_DIR)) return [];
  const all = readdirSync(OUTPUT_DIR).filter((f) => f.endsWith('.xlsx'));
  if (filterFiles && filterFiles.length > 0) {
    return all.filter((f) => filterFiles.includes(f.replace('.xlsx', '')));
  }
  return all;
}

function loadRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], wb, sheetName: wb.SheetNames[0] };
  const rows = XLSX.utils.sheet_to_json(ws);
  return { rows: Array.isArray(rows) ? rows : [], wb, sheetName: wb.SheetNames[0] };
}

function saveRows(filePath, rows, wb, sheetName) {
  const ws = XLSX.utils.json_to_sheet(rows);
  wb.Sheets[sheetName] = ws;
  XLSX.writeFile(wb, filePath);
}

function isValidEmail(val) {
  return val && typeof val === 'string' && EMAIL_REGEX.test(val.trim());
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };

  const maxEmails = parseInt(getArg('--max') || String(MAX_EMAILS_PER_RUN), 10) || MAX_EMAILS_PER_RUN;
  const filesArg = getArg('--files');
  const filterFiles = filesArg ? filesArg.split(',').map((f) => f.trim()) : null;

  const excelFiles = getExcelFiles(filterFiles);
  if (excelFiles.length === 0) {
    console.log('No Excel files found in output/');
    return;
  }

  console.log(`Found ${excelFiles.length} Excel file(s). Max ${maxEmails} emails per run.\n`);

  let sentCount = 0;
  const toSend = [];

  for (const file of excelFiles) {
    const path = join(OUTPUT_DIR, file);
    const { rows, wb, sheetName } = loadRows(path);
    for (let i = 0; i < rows.length; i++) {
      if (sentCount + toSend.length >= maxEmails) break;
      const row = rows[i];
      const email = row.email;
      if (!isValidEmail(email)) continue;
      if (row.sent === 'yes' || row.sent === 'Yes' || row.Sent === 'yes') continue;
      toSend.push({ file, path, rows, wb, sheetName, rowIndex: i });
    }
  }

  if (toSend.length === 0) {
    console.log('No unsent emails found in Excel files.');
    return;
  }

  console.log(`Sending ${Math.min(toSend.length, maxEmails)} emails...\n`);

  for (let i = 0; i < toSend.length && sentCount < maxEmails; i++) {
    const { file, path, rows, wb, sheetName, rowIndex } = toSend[i];
    const row = rows[rowIndex];
    const email = (row.email || '').trim();

    try {
      await sendEmailGmail({
        to: email,
        subject: EMAIL_SUBJECT,
        text: EMAIL_BODY,
      });
      row.sent = 'yes';
      saveRows(path, rows, wb, sheetName);
      sentCount++;
      console.log(`[${sentCount}/${maxEmails}] Sent to ${email} (${file})`);
    } catch (err) {
      console.warn(`Failed to send to ${email}: ${err.message}`);
    }

    if (i < toSend.length - 1) {
      await delay(DELAY_BETWEEN_EMAILS_MS);
    }
  }

  console.log(`\nDone. Sent ${sentCount} email(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
