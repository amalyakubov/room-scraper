import puppeteer from "puppeteer";
import type { Room, SearchOptions } from "../types";

const MAX_PAGES = 10; // Safety limit

export async function scrapeOtodom(options: SearchOptions): Promise<Room[]> {
  const browser = await puppeteer.launch({
    headless: true,
    timeout: 30000,
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  );

  const allRooms: Room[] = [];
  const pagesToScrape = Math.min(options.pages || 5, MAX_PAGES);

  try {
    for (let pageNum = 1; pageNum <= pagesToScrape; pageNum++) {
      // Build URL for rooms for rent in Warsaw
      let url =
        "https://www.otodom.pl/pl/wyniki/wynajem/pokoj/mazowieckie/warszawa/warszawa/warszawa";

      const params: string[] = [];
      if (options.maxPrice) {
        params.push(`priceMax=${options.maxPrice}`);
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

      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

      // Accept cookies on first page
      if (pageNum === 1) {
        try {
          const cookieButton = await page.$("#onetrust-accept-btn-handler");
          if (cookieButton) {
            await cookieButton.click();
            await new Promise((r) => setTimeout(r, 1000));
          }
        } catch {
          // Continue if no cookie popup
        }
      }

      // Wait for listings
      const listingSelectors = [
        '[data-cy="search.listing"]',
        '[data-cy="search.listing.organic"]',
        "article",
        '[class*="listing"]',
      ];

      for (const selector of listingSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          break;
        } catch {
          continue;
        }
      }

      await new Promise((r) => setTimeout(r, 1500));

      // Extract listings
      const rooms = await page.evaluate(() => {
        const listings: Array<{
          title: string;
          price: number | null;
          currency: string;
          location: string;
          url: string;
          source: "otodom";
          area?: number;
          imageUrl?: string;
        }> = [];

        const cardSelectors = [
          '[data-cy="listing-item"]',
          '[data-cy="search.listing.organic"] li',
          'ul[data-cy="search.listing"] > li',
          'a[href*="/pl/oferta/"]',
        ];

        let cards: Element[] = [];
        for (const selector of cardSelectors) {
          const found = document.querySelectorAll(selector);
          if (found.length > 0) {
            cards = Array.from(found);
            break;
          }
        }

        cards.forEach((card) => {
          const container =
            card.closest("li") || card.closest("article") || card;
          const linkEl =
            container.querySelector('a[href*="/pl/oferta/"]') ||
            container.querySelector("a");
          const titleEl =
            container.querySelector('[data-cy="listing-item-title"]') ||
            container.querySelector("h3") ||
            container.querySelector("p[data-cy]");
          const areaEl = container.querySelector(
            'span[aria-label*="Powierzchnia"]',
          );
          const imgEl = container.querySelector("img");

          if (!linkEl) return;

          const href = (linkEl as HTMLAnchorElement).getAttribute("href") || "";
          if (!href.includes("/oferta/")) return;

          // Extract price from container text
          const allContainerText = container.textContent || "";
          const priceMatch = allContainerText.match(/(\d[\d\s]*)\s*zł/i);
          let price = null;
          if (priceMatch && priceMatch[1]) {
            price = parseInt(priceMatch[1].replace(/\s/g, ""), 10);
          }

          const areaText = areaEl?.textContent || "";
          const areaMatch = areaText.match(/(\d+)/);
          let area = undefined;
          if (areaMatch && areaMatch[1]) {
            area = parseInt(areaMatch[1], 10);
          }

          const fullUrl = href.startsWith("http")
            ? href
            : `https://www.otodom.pl${href}`;

          if (listings.some((l) => l.url === fullUrl)) return;

          let title = titleEl?.textContent?.trim() || "";
          if (!title) {
            title = "Room in Warsaw";
          }

          // Try to find location
          let location = "Warszawa";
          const locationPatterns = [
            /Warszawa,\s*([\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+)/i,
            /Warszawa\s+([\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ-]+)/i,
          ];
          for (const pattern of locationPatterns) {
            const match = allContainerText.match(pattern);
            if (
              match &&
              match[1] &&
              !match[1].includes("zł") &&
              !match[1].includes("Cena")
            ) {
              location = `Warszawa, ${match[1]}`;
              break;
            }
          }

          listings.push({
            title,
            price,
            currency: "PLN",
            location,
            url: fullUrl,
            source: "otodom" as const,
            area,
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
        const nextBtn =
          document.querySelector('[data-cy="pagination.next-page"]') ||
          document.querySelector('a[aria-label*="next"]') ||
          document.querySelector('button[aria-label*="Następna"]');
        return nextBtn !== null && !nextBtn.hasAttribute("disabled");
      });

      if (!hasNextPage || rooms.length === 0) {
        break;
      }

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 500));
    }

    // Apply filters
    let filteredRooms = allRooms;
    if (options.roomType) {
      const keywords = getRoomTypeKeywords(options.roomType);
      filteredRooms = allRooms.filter((room) =>
        keywords.some((kw) => room.title.toLowerCase().includes(kw)),
      );
    }

    if (options.maxPrice) {
      filteredRooms = filteredRooms.filter(
        (room) => room.price === null || room.price <= options.maxPrice!,
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
      return [
        "współlokator",
        "współdziel",
        "shared",
        "2-osobowy",
        "dwuosobowy",
      ];
    case "studio":
      return ["kawalerka", "studio", "garsoniera"];
    case "apartment":
      return ["mieszkanie", "apartment", "flat"];
    default:
      return [];
  }
}
