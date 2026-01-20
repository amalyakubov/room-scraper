import puppeteer from "puppeteer";
import type { Room, SearchOptions } from "../types";

const MAX_PAGES = 10; // Safety limit

export async function scrapeOlx(options: SearchOptions): Promise<Room[]> {
  const browser = await puppeteer.launch({
    headless: true,
    timeout: 30000,
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"
  );

  const allRooms: Room[] = [];
  const pagesToScrape = Math.min(options.pages || 5, MAX_PAGES);

  try {
    for (let pageNum = 1; pageNum <= pagesToScrape; pageNum++) {
      // Build the URL for rooms/flatmates in Warsaw
      let url = "https://www.olx.pl/nieruchomosci/stancje-pokoje/warszawa/";

      const params: string[] = [];
      if (options.maxPrice) {
        params.push(`search%5Bfilter_float_price%3Ato%5D=${options.maxPrice}`);
      }
      if (pageNum > 1) {
        params.push(`page=${pageNum}`);
      }
      if (params.length > 0) {
        url += `?${params.join("&")}`;
      }

      if (pageNum > 1) {
        process.stdout.write(`    Page ${pageNum}/${pagesToScrape}...`);
      }

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Wait for listings to load - try multiple selectors
      try {
        await page.waitForSelector('[data-testid="listing-grid"]', { timeout: 10000 });
      } catch {
        await page.waitForSelector('[data-cy="l-card"]', { timeout: 10000 }).catch(() => {});
      }

      // Accept cookies on first page
      if (pageNum === 1) {
        try {
          const cookieButton = await page.$("#onetrust-accept-btn-handler");
          if (cookieButton) {
            await cookieButton.click();
            await page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
          }
        } catch {
          // Cookie popup didn't appear
        }
      }

      // Extract room listings
      const rooms = await page.evaluate(() => {
        const listings: Array<{
          title: string;
          price: number | null;
          currency: string;
          location: string;
          url: string;
          source: "olx";
          imageUrl?: string;
        }> = [];

        const selectors = [
          '[data-testid="listing-grid"] [data-testid="adCard"]',
          '[data-cy="l-card"]',
          'div[data-testid="listing-grid"] > div > div',
          'a[href*="/d/oferta/"]',
        ];

        let cards: Element[] = [];
        for (const selector of selectors) {
          const found = document.querySelectorAll(selector);
          if (found.length > 0) {
            cards = Array.from(found);
            break;
          }
        }

        cards.forEach((card) => {
          const container = card.closest('[data-cy="l-card"]') || card.closest('[data-testid="adCard"]') || card;
          const linkEl = container.querySelector("a") || (card.tagName === "A" ? card : null);
          const titleEl = container.querySelector("h4, h6, [data-cy='ad-title']");
          const priceEl = container.querySelector('[data-testid="ad-price"], [data-cy="ad-price"]');
          const locationEl = container.querySelector('[data-testid="location-date"], [data-cy="location-date"]');
          const imgEl = container.querySelector("img");

          if (!linkEl) return;

          const priceText = priceEl?.textContent || "";
          const priceMatch = priceText.replace(/\s/g, "").match(/(\d+)/);
          const price = priceMatch ? parseInt(priceMatch[1], 10) : null;

          const href = (linkEl as HTMLAnchorElement).getAttribute("href") || "";
          if (!href.includes("/d/") && !href.includes("/oferta/")) return;

          const fullUrl = href.startsWith("http") ? href : `https://www.olx.pl${href}`;

          if (listings.some((l) => l.url === fullUrl)) return;

          listings.push({
            title: titleEl?.textContent?.trim() || "Room listing",
            price,
            currency: "PLN",
            location: locationEl?.textContent?.split(" - ")[0]?.trim() || "Warszawa",
            url: fullUrl,
            source: "olx" as const,
            imageUrl: imgEl?.getAttribute("src") || undefined,
          });
        });

        return listings;
      });

      // Add unique rooms
      for (const room of rooms) {
        if (!allRooms.some((r) => r.url === room.url)) {
          allRooms.push(room);
        }
      }

      if (pageNum > 1) {
        console.log(` +${rooms.length} rooms`);
      }

      // Check if there's a next page
      const hasNextPage = await page.evaluate(() => {
        const nextBtn = document.querySelector('[data-testid="pagination-forward"]');
        return nextBtn !== null && !nextBtn.hasAttribute("disabled");
      });

      if (!hasNextPage) {
        break; // No more pages
      }

      // Small delay between pages to be nice to the server
      await new Promise((r) => setTimeout(r, 500));
    }

    // Apply filters
    let filteredRooms = allRooms;
    if (options.roomType) {
      const keywords = getRoomTypeKeywords(options.roomType);
      filteredRooms = allRooms.filter((room) =>
        keywords.some((kw) => room.title.toLowerCase().includes(kw))
      );
    }

    if (options.maxPrice) {
      filteredRooms = filteredRooms.filter(
        (room) => room.price === null || room.price <= options.maxPrice!
      );
    }

    return filteredRooms;
  } finally {
    await browser.close();
  }
}

function getRoomTypeKeywords(roomType: string): string[] {
  switch (roomType) {
    case "single":
      return ["jednoosobowy", "1-osobowy", "single", "dla jednej"];
    case "shared":
      return ["współlokator", "współdziel", "shared", "2-osobowy", "dwuosobowy"];
    case "studio":
      return ["kawalerka", "studio", "garsoniera"];
    case "apartment":
      return ["mieszkanie", "apartment", "flat"];
    default:
      return [];
  }
}
