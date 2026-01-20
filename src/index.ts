import { parseArgs } from "util";
import { scrapeOlx } from "./scrapers/olx";
import { scrapeOtodom } from "./scrapers/otodom";
import type { Room, SearchOptions } from "./types";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    maxPrice: {
      type: "string",
      short: "p",
    },
    roomType: {
      type: "string",
      short: "t",
    },
    source: {
      type: "string",
      short: "s",
      default: "all",
    },
    pages: {
      type: "string",
      short: "n",
      default: "5",
    },
    json: {
      type: "boolean",
      short: "j",
      default: false,
    },
    help: {
      type: "boolean",
      short: "h",
      default: false,
    },
  },
});

if (values.help) {
  console.log(`
Warsaw Room Scraper - Find rooms for rent in Warsaw

Usage: bun run scrape [options]

Options:
  -p, --maxPrice <amount>   Maximum price in PLN (e.g., 2500)
  -t, --roomType <type>     Room type: single, shared, studio, apartment
  -s, --source <source>     Source: olx, otodom, all (default: all)
  -n, --pages <num>         Number of pages to scrape per source (default: 5, max: 10)
  -j, --json                Output as JSON
  -h, --help                Show this help message

Examples:
  bun run scrape                          # Scrape 5 pages from all sources
  bun run scrape -p 2000                  # Max price 2000 PLN
  bun run scrape -n 10                    # Scrape 10 pages (more results)
  bun run scrape -s olx -p 1800           # Only OLX, max 1800 PLN
  bun run scrape --json > rooms.json      # Save to JSON file
`);
  process.exit(0);
}

const options: SearchOptions = {
  maxPrice: values.maxPrice ? parseInt(values.maxPrice, 10) : undefined,
  roomType: values.roomType as SearchOptions["roomType"],
  pages: values.pages ? parseInt(values.pages, 10) : 5,
};

async function main() {
  const pagesInfo =
    options.pages && options.pages > 1 ? ` (${options.pages} pages each)` : "";
  console.log(`Scraping rooms for rent in Warsaw${pagesInfo}...\n`);

  const rooms: Room[] = [];
  const source = values.source?.toLowerCase();

  try {
    if (source === "all" || source === "olx") {
      console.log("Scraping OLX.pl...");
      const olxRooms = await scrapeOlx(options);
      rooms.push(...olxRooms);
      console.log(`  Found ${olxRooms.length} rooms on OLX\n`);
    }

    if (source === "all" || source === "otodom") {
      console.log("Scraping Otodom.pl...");
      const otodomRooms = await scrapeOtodom(options);
      rooms.push(...otodomRooms);
      console.log(`  Found ${otodomRooms.length} rooms on Otodom\n`);
    }

    // Sort by price (lowest first), nulls at end
    rooms.sort((a, b) => {
      if (a.price === null) return 1;
      if (b.price === null) return -1;
      return a.price - b.price;
    });

    if (values.json) {
      console.log(JSON.stringify(rooms, null, 2));
      let date = new Date();
      let filename = `${date.getUTCDate()}-${date.getUTCMonth() + 1}-${date.getUTCFullYear()}.json`;
      Bun.write(filename, JSON.stringify(rooms, null, 2));
    } else {
      displayResults(rooms);
    }
  } catch (error) {
    console.error("Error scraping:", error);
    process.exit(1);
  }
}

function displayResults(rooms: Room[]) {
  if (rooms.length === 0) {
    console.log("No rooms found matching your criteria.");
    return;
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`Found ${rooms.length} rooms total`);
  console.log(`${"=".repeat(80)}\n`);

  for (const room of rooms) {
    const price = room.price
      ? `${room.price} ${room.currency}`
      : "Price not specified";
    const area = room.area ? ` | ${room.area}m²` : "";

    console.log(`[${room.source.toUpperCase()}] ${room.title}`);
    console.log(`  Price: ${price}${area}`);
    console.log(`  Location: ${room.location}`);
    console.log(`  URL: ${room.url}`);
    console.log("");
  }
}

main();
