export interface Room {
  title: string;
  price: number | null;
  currency: string;
  location: string;
  url: string;
  source: "olx" | "otodom";
  roomType?: string;
  area?: number;
  imageUrl?: string;
}

export interface SearchOptions {
  maxPrice?: number;
  roomType?: "single" | "shared" | "studio" | "apartment";
  district?: string;
  pages?: number;
}

export type Scraper = (options: SearchOptions) => Promise<Room[]>;
