/**
 * Send email via Gmail SMTP (Nodemailer).
 * Requires in .env: GMAIL_USER, APP_PASSWORD (Gmail app password).
 *
 * Usage:
 *   node src/sendEmailGmail.js
 *   node src/sendEmailGmail.js --to "recipient@example.com" --subject "Hello" --text "Hi there"
 *
 * Or import and use sendEmailGmail() in other modules.
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import nodemailer from 'nodemailer';

const __filename = resolve(fileURLToPath(import.meta.url));

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('GMAIL_USER and APP_PASSWORD must be set in .env');
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

/**
 * Send an email via Gmail SMTP.
 * @param {Object} opts
 * @param {string} [opts.from] - Sender (defaults to GMAIL_USER)
 * @param {string|string[]} opts.to - Recipient(s)
 * @param {string} opts.subject - Subject line
 * @param {string} [opts.html] - HTML body
 * @param {string} [opts.text] - Plain text body (alternative to html)
 * @returns {Promise<{ messageId?: string }>}
 */
export async function sendEmailGmail(opts) {
  const { from, to, subject, html, text } = opts;
  const user = process.env.GMAIL_USER;
  if (!user) throw new Error('GMAIL_USER must be set in .env');
  const recipients = Array.isArray(to) ? to : [to];
  if (!recipients.length || !subject) {
    throw new Error('to and subject are required');
  }
  if (!html && !text) {
    throw new Error('Either html or text body is required');
  }

  const transporter = getTransporter();
  const sender = from || `Milos <${user}>`;

  const info = await transporter.sendMail({
    from: sender,
    to: recipients.join(', '),
    subject,
    ...(html && { html }),
    ...(text && { text }),
  });

  return { messageId: info.messageId };
}

/**
 * CLI: send a test email or use args.
 */
async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };

  const to = getArg('--to') || process.env.GMAIL_USER;
  const subject = getArg('--subject') || 'Test from Gmail SMTP';
  const text = getArg('--text') || 'It works!';
  const html = getArg('--html');

  try {
    const result = await sendEmailGmail({
      to,
      subject,
      ...(html ? { html } : { text }),
    });
    console.log('Email sent:', result.messageId);
  } catch (err) {
    console.error('Error sending email:', err.message);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
