# PenpalsNow Scraper

Node.js scraper for [penpalsnow.com](https://www.penpalsnow.com) pen pal ads. **No browser** – uses `fetch` + [cheerio](https://cheerio.js.org/) to parse HTML, then gets emails via the site’s API.

## How it works

1. **Fetch** the listing page HTML (e.g. `.../ads/sexcountry/AUmale.html`).
2. **Parse** with cheerio: find all `a.showemail.ppadvaluebold` (first 5 per page) and read each element’s **id** (e.g. `2edc26442a8d4697eda0bef78a2d9db5`).
3. **Get emails** by calling `GET https://www.penpalsnow.com/_api/showemail.php?e={id}` for each id.
4. **Ad fields** (name, gender, age, city/country, hobbies, message, last modified) are taken from the HTML block that contains each link.
5. **Pagination:** the script finds the “Next 5 pen pal ads” form, submits it (GET or POST), fetches the next page HTML, and repeats until there is no next form or `maxPages` is reached.
6. **Output:** one Excel file per run (e.g. `output/AUmale.xlsx`).

## Requirements

- Node.js 18+ (for native `fetch`)
- npm

## Setup

```bash
npm install
```

## Usage

```bash
# Default: AU, male
npm run scrape

# Country and sex as CLI args
node src/scraper.js AU male
node src/scraper.js CA female
node src/scraper.js US male
node src/scraper.js UK female
```

**Country codes:** `AU`, `CA`, `US`, `UK` (others may work if the URL pattern is the same).

**Sex:** `male` or `female`.

## Options (in code)

In `src/scraper.js`, `scrapeAllPages()` is called with:

- **maxPages** – stop after this many pages (default: 999).
- **requestDelayMs** – delay between each `showemail.php` request (default: 300 ms).

## Output

Excel file in `output/` named like `AUmale.xlsx`, `UKfemale.xlsx`, etc. Each row is one ad with columns: name, gender, ageGroup, cityCountry, hobbies, message, lastModified, email.

## License

MIT
