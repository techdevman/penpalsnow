/**
 * Send email via Resend.com
 * Requires: RESEND_API_KEY env var (in .env or environment)
 *
 * Usage:
 *   node src/sendEmail.js
 *   node src/sendEmail.js --to "recipient@example.com" --subject "Hello" --html "<p>Hi</p>"
 *
 * Or import and use sendEmail() in other modules.
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { Resend } from 'resend';

const __filename = resolve(fileURLToPath(import.meta.url));
const resend = new Resend(process.env.RESEND_API_KEY || '');

/**
 * Send an email via Resend.
 * @param {Object} opts
 * @param {string} opts.from - Sender (e.g. 'Acme <onboarding@resend.dev>')
 * @param {string|string[]} opts.to - Recipient(s)
 * @param {string} opts.subject - Subject line
 * @param {string} [opts.html] - HTML body
 * @param {string} [opts.text] - Plain text body (alternative to html)
 * @returns {Promise<{ data?: object; error?: object }>}
 */
export async function sendEmail(opts) {
  const { from, to, subject, html, text } = opts;
  const recipients = Array.isArray(to) ? to : [to];

  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is required');
  }
  if (!from || !recipients.length || !subject) {
    throw new Error('from, to, and subject are required');
  }
  if (!html && !text) {
    throw new Error('Either html or text body is required');
  }

  const payload = {
    from,
    to: recipients,
    subject,
    ...(html && { html }),
    ...(text && { text }),
  };

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    throw new Error(JSON.stringify(error));
  }

  return { data };
}

/**
 * CLI: send a test email or use args.
 * Default sends to delivered@resend.dev for testing.
 */
async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };

  const to = getArg('--to') || 'delivered@resend.dev';
  const subject = getArg('--subject') || 'Hello from PenpalsNow scraper';
  const html = getArg('--html') || '<strong>It works!</strong>';
  const from = getArg('--from') || 'Acme <onboarding@resend.dev>';

  try {
    const result = await sendEmail({ from, to, subject, html });
    console.log('Email sent:', result.data);
  } catch (err) {
    console.error('Error sending email:', err.message);
    process.exit(1);
  }
}

// Run CLI if executed directly (node src/sendEmail.js)
if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
