# PenpalsNow Scraper

Node.js scraper for [penpalsnow.com](https://www.penpalsnow.com) pen pal ads. The site is JavaScript-rendered and hides emails behind “Hidden, click here to show e-mail” links, so this project uses **Puppeteer** to load the page, click those links, and extract the revealed emails plus ad metadata.

## How it works

1. **Load the page** in a headless Chromium (Puppeteer).
2. **Find “show e-mail” links** with selector: `a.showemail.ppadvaluebold`.
3. **Click each link** to reveal the email (DOM/text or `mailto:` href).
4. **Scrape** the revealed email and ad fields (name, gender, age, city/country, hobbies, message, last modified).
5. **Pagination:** each page shows 5 ads; then the script clicks **“Next 5 pen pal ads”** and repeats until there is no next page (or `maxPages` is reached).

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
```

## Usage

```bash
# Default: AU, male
npm run scrape

# Country and sex as CLI args (country code, then sex)
node src/scraper.js AU male
node src/scraper.js CA female
node src/scraper.js US male
node src/scraper.js UK female
```

**Country codes:** `AU`, `CA`, `US`, `UK` (others may work if the site uses the same URL pattern).

**Sex:** `male` or `female`.

URL pattern: `https://www.penpalsnow.com/ads/sexcountry/{COUNTRY}{sex}.html`  
Examples: `AUmale.html`, `CAfemale.html`, `USmale.html`, `UKfemale.html`.

## Options (in code)

In `src/scraper.js`, `scrapeAllPages()` is called with:

- **maxPages** – stop after this many pages (default: 999).
- **clickDelayMs** – delay between clicking each “show email” link (default: 600 ms).

Pagination uses the **“Next 5 pen pal ads”** button (`input.button[type="submit"][value="Next 5 pen pal ads"]`); scraping continues until the button is gone or `maxPages` is reached.

## Output

JSON array of ad objects, e.g.:

```json
{
  "name": "Charlie H.",
  "gender": "male",
  "ageGroup": "50+",
  "cityCountry": "Australia",
  "hobbies": "Hedonism, Pleasure, adult conversation",
  "message": "There comes a time in life...",
  "lastModified": "20260202",
  "email": "revealed@example.com"
}
```

If the email is not revealed by the click (e.g. JS error or different DOM), `email` may be `null`; the script also tries to pull an email from the message text when it looks like an address.

## License

MIT
