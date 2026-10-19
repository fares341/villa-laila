import fs from 'fs';
import path from 'path';
import { q } from '@/lib/db';

export const HOSTELWORLD_PROPERTY_ID = 330811;

export interface RoomSyncInfo {
  hwId: number;
  fallbackPrice: number;
  kind: 'private' | 'dorm';
  sleeps: number;
  perBed?: boolean;
}

export const ROOM_TO_HW_MAP: Record<string, RoomSyncInfo> = {
  'sheherazade': { hwId: 1004577, fallbackPrice: 75, kind: 'private', sleeps: 2 },
  'french-lady': { hwId: 1004571, fallbackPrice: 75, kind: 'private', sleeps: 2 },
  'ibn-battuta': { hwId: 1004570, fallbackPrice: 65, kind: 'private', sleeps: 2 },
  'folklore': { hwId: 990641, fallbackPrice: 65, kind: 'private', sleeps: 2 },
  'mamluk': { hwId: 1004578, fallbackPrice: 64, kind: 'private', sleeps: 2 },
  'violet': { hwId: 1004572, fallbackPrice: 59, kind: 'private', sleeps: 2 },
  'amira': { hwId: 1004572, fallbackPrice: 59, kind: 'private', sleeps: 2 },
  'triple': { hwId: 990305, fallbackPrice: 59, kind: 'private', sleeps: 3 },
  'golden-room': { hwId: 990261, fallbackPrice: 49, kind: 'private', sleeps: 2 },
  'islamic': { hwId: 990261, fallbackPrice: 49, kind: 'private', sleeps: 2 },
  'female-dorm-8': { hwId: 990309, fallbackPrice: 18, kind: 'dorm', sleeps: 8, perBed: true },
  'female-dorm-6': { hwId: 990303, fallbackPrice: 18, kind: 'dorm', sleeps: 6, perBed: true },
  'male-dorm-8-pool': { hwId: 990639, fallbackPrice: 18, kind: 'dorm', sleeps: 8, perBed: true },
  'male-dorm-8': { hwId: 2003782, fallbackPrice: 17, kind: 'dorm', sleeps: 8, perBed: true },
  'mixed-dorm-10': { hwId: 990310, fallbackPrice: 17, kind: 'dorm', sleeps: 10, perBed: true },
};

export interface LiveRoomStatus {
  slug: string;
  price: number;
  currency: string;
  available: boolean;
  bedsAvailable: number | null;
  status: 'available' | 'few_left' | 'sold_out';
  lastUpdated: string;
  source: 'hostelworld_live' | 'cache' | 'fallback';
}

export interface SyncResult {
  success: boolean;
  propertyId: number;
  syncedAt: string;
  dateStart: string;
  numNights: number;
  currency: string;
  rooms: Record<string, LiveRoomStatus>;
  error?: string;
}

const CACHE_FILE = path.join(process.cwd(), 'public', 'data', 'hostelworld-cache.json');
let memCache: SyncResult | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function readCachedRates(): SyncResult | null {
  if (memCache && Date.now() - lastFetchTime < CACHE_TTL_MS) {
    return memCache;
  }
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      memCache = data;
      return data;
    }
  } catch (e) {
    console.error('[Hostelworld] Error reading cache:', e);
  }
  return null;
}

function writeCachedRates(data: SyncResult) {
  memCache = data;
  lastFetchTime = Date.now();
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Hostelworld] Error writing cache:', e);
  }
}

export function getDefaultRates(dateStart = new Date().toISOString().slice(0, 10)): SyncResult {
  const rooms: Record<string, LiveRoomStatus> = {};
  const now = new Date().toISOString();
  for (const [slug, info] of Object.entries(ROOM_TO_HW_MAP)) {
    rooms[slug] = {
      slug,
      price: info.fallbackPrice,
      currency: 'USD',
      available: true,
      bedsAvailable: info.kind === 'dorm' ? 4 : 1,
      status: 'available',
      lastUpdated: now,
      source: 'fallback',
    };
  }
  return {
    success: true,
    propertyId: HOSTELWORLD_PROPERTY_ID,
    syncedAt: now,
    dateStart,
    numNights: 1,
    currency: 'USD',
    rooms,
  };
}

/**
 * Fetch live availability and rates directly from Hostelworld API
 */
export async function syncHostelworldData(options?: {
  dateStart?: string;
  nights?: number;
  currency?: string;
  force?: boolean;
}): Promise<SyncResult> {
  const force = options?.force ?? false;
  const now = new Date();
  
  // Format target date: defaults to tomorrow if not specified
  let dateStart = options?.dateStart;
  if (!dateStart) {
    const tmrw = new Date(now.getTime() + 24 * 3600 * 1000);
    dateStart = tmrw.toISOString().slice(0, 10);
  }
  const nights = options?.nights ?? 1;
  const currency = options?.currency ?? 'USD';

  if (!force) {
    const cached = readCachedRates();
    if (cached && cached.dateStart === dateStart && cached.currency === currency) {
      return cached;
    }
  }

  const url = `https://api.m.hostelworld.com/2.2/properties/${HOSTELWORLD_PROPERTY_ID}/availability/?date-start=${dateStart}&num-nights=${nights}&currency=${currency}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      next: { revalidate: 900 },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Hostelworld HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const dorms = (data.rooms?.dorms || []) as any[];
    const privates = (data.rooms?.privates || []) as any[];

    // Index by HW ID
    const hwRoomsById = new Map<number, any>();
    for (const d of dorms) hwRoomsById.set(Number(d.id), d);
    for (const p of privates) hwRoomsById.set(Number(p.id), p);

    const syncedRooms: Record<string, LiveRoomStatus> = {};
    const timestamp = new Date().toISOString();

    for (const [slug, info] of Object.entries(ROOM_TO_HW_MAP)) {
      const hwRoom = hwRoomsById.get(info.hwId);
      if (hwRoom) {
        // Price extraction
        const priceVal =
          hwRoom.lowestPricePerNight?.value ??
          hwRoom.averagePricePerNight?.[0]?.price?.value ??
          hwRoom.totalPrice?.[0]?.price?.value;
        const numPrice = priceVal ? Math.round(parseFloat(priceVal)) : info.fallbackPrice;

        const bedsAvailable = hwRoom.totalBedsAvailable ?? hwRoom.totalRoomsAvailable ?? null;
        const available = bedsAvailable !== null ? bedsAvailable > 0 : true;

        let status: 'available' | 'few_left' | 'sold_out' = 'available';
        if (!available || bedsAvailable === 0) {
          status = 'sold_out';
        } else if (bedsAvailable !== null && bedsAvailable <= 2) {
          status = 'few_left';
        }

        syncedRooms[slug] = {
          slug,
          price: numPrice > 0 ? numPrice : info.fallbackPrice,
          currency: hwRoom.lowestPricePerNight?.currency || currency,
          available,
          bedsAvailable,
          status,
          lastUpdated: timestamp,
          source: 'hostelworld_live',
        };
      } else {
        // Room not available on this date in HW response (sold out on HW)
        syncedRooms[slug] = {
          slug,
          price: info.fallbackPrice,
          currency,
          available: false,
          bedsAvailable: 0,
          status: 'sold_out',
          lastUpdated: timestamp,
          source: 'hostelworld_live',
        };
      }
    }

    const result: SyncResult = {
      success: true,
      propertyId: HOSTELWORLD_PROPERTY_ID,
      syncedAt: timestamp,
      dateStart,
      numNights: nights,
      currency,
      rooms: syncedRooms,
    };

    writeCachedRates(result);

    // Optionally update rates in DB if connected
    try {
      for (const [slug, r] of Object.entries(syncedRooms)) {
        if (r.price > 0) {
          const cents = r.price * 100;
          await q(
            `UPDATE rates SET price_cents=$1, updated_at=now() WHERE room_type_id IN (SELECT id FROM room_types WHERE code=$2)`,
            [cents, slug]
          ).catch(() => {});
        }
      }
    } catch (dbErr) {
      // Non-fatal if DB is in read-only mode or migration differs
    }

    return result;
  } catch (err: any) {
    console.warn('[Hostelworld Sync] Live fetch error:', err.message);
    const cached = readCachedRates();
    if (cached) return cached;
    return getDefaultRates(dateStart);
  }
}
