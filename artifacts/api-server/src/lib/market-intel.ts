import { and, desc, eq } from "drizzle-orm";
import { db, commoditiesTable, mandisTable, marketPricesTable, statesTable } from "@workspace/db";
import type { Forecast, ForecastPoint, MarketToday, MandiComparison } from "@workspace/api-zod";

type MarketSelection = {
  commodityId: string;
  mandiId: string;
  varietyId?: string;
};

type MarketJoinRow = {
  price: typeof marketPricesTable.$inferSelect;
  commodity: typeof commoditiesTable.$inferSelect;
  mandi: typeof mandisTable.$inferSelect;
  state: typeof statesTable.$inferSelect;
};

const money = (value: string | number) => Number(value);
const calendarDate = (value: Date) => value.toISOString().slice(0, 10);

export async function getMarketHistory(selection: MarketSelection, limit = 22): Promise<MarketJoinRow[]> {
  const varietyFilter = selection.varietyId
    ? eq(marketPricesTable.varietyId, selection.varietyId)
    : undefined;
  return db
    .select({ price: marketPricesTable, commodity: commoditiesTable, mandi: mandisTable, state: statesTable })
    .from(marketPricesTable)
    .innerJoin(commoditiesTable, eq(marketPricesTable.commodityId, commoditiesTable.id))
    .innerJoin(mandisTable, eq(marketPricesTable.mandiId, mandisTable.id))
    .innerJoin(statesTable, eq(mandisTable.stateId, statesTable.id))
    .where(and(
      eq(marketPricesTable.commodityId, selection.commodityId),
      eq(marketPricesTable.mandiId, selection.mandiId),
      varietyFilter,
      eq(commoditiesTable.enabled, true),
      eq(mandisTable.enabled, true),
    ))
    .orderBy(desc(marketPricesTable.marketDate))
    .limit(limit);
}

export function marketToday(row: MarketJoinRow, varietyName: string | null = null): MarketToday {
  return {
    commodityId: row.price.commodityId,
    commodityName: row.commodity.name,
    mandiId: row.price.mandiId,
    mandiName: row.mandi.name,
    stateName: row.state.name,
    varietyId: row.price.varietyId,
    varietyName,
    date: new Date(`${row.price.marketDate}T00:00:00.000Z`),
    minimumPrice: money(row.price.minimumPrice),
    maximumPrice: money(row.price.maximumPrice),
    modalPrice: money(row.price.modalPrice),
    arrivals: money(row.price.arrivals),
    arrivalUnit: row.price.arrivalUnit,
    unit: row.price.unit,
    changePercent: money(row.price.changePercent),
    source: row.price.source,
    lastUpdated: row.price.lastUpdated,
    isDemo: row.price.isDemo,
  };
}

function distanceKm(from: typeof mandisTable.$inferSelect, to: typeof mandisTable.$inferSelect): number {
  if (from.latitude == null || from.longitude == null || to.latitude == null || to.longitude == null) return 0;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export async function forecastForMarket(selection: MarketSelection): Promise<Forecast | null> {
  const rows = await getMarketHistory(selection);
  if (!rows.length) return null;
  const ordered = [...rows].reverse();
  const current = ordered[ordered.length - 1]!;
  const prices = ordered.map((row) => money(row.price.modalPrice));
  const currentPrice = prices[prices.length - 1]!;
  const observations = prices.slice(-14);
  const avgPrice = observations.reduce((sum, price) => sum + price, 0) / observations.length;
  const slope = observations.length > 1
    ? observations.reduce((sum, price, i) => sum + (i - (observations.length - 1) / 2) * (price - avgPrice), 0)
      / observations.reduce((sum, _price, i) => sum + (i - (observations.length - 1) / 2) ** 2, 0)
    : 0;
  const boundedSlope = Math.max(-avgPrice * 0.025, Math.min(avgPrice * 0.025, slope));
  const pointDate = (daysAhead: number) => {
    const date = new Date(`${current.price.marketDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + daysAhead);
    return calendarDate(date);
  };
  const points: ForecastPoint[] = [{
    date: new Date(`${current.price.marketDate}T00:00:00.000Z`),
    label: "Today",
    price: currentPrice,
    kind: "actual",
  }];
  for (let day = 1; day <= 7; day += 1) {
    const price = Math.max(0, Math.round((currentPrice + boundedSlope * day) / 10) * 10);
    points.push({
      date: new Date(`${pointDate(day)}T00:00:00.000Z`),
      label: `Day ${day}`,
      price,
      kind: "forecast",
    });
  }
  const expectedPrice = points[7]!.price;
  const expectedChangePercent = currentPrice ? ((expectedPrice - currentPrice) / currentPrice) * 100 : 0;
  const recommendation: Forecast["recommendation"] = "WAIT";
  const reason = "This demo trend has no independently validated forecast confidence. Wait for a verified forecast before using a hold or release signal.";
  return {
    commodityName: current.commodity.name,
    mandiName: current.mandi.name,
    unit: current.price.unit,
    points,
    currentPrice,
    expectedPrice,
    expectedChangePercent: Math.round(expectedChangePercent * 10) / 10,
    recommendation,
    reason,
    confidence: null,
    modelStatus: "demo",
    isDemo: true,
  };
}

export async function compareMarketReturns(
  selection: MarketSelection & { stateId: string; quantityQtl: number },
): Promise<MandiComparison[]> {
  const [baseline] = await db.select().from(mandisTable).where(eq(mandisTable.id, selection.mandiId)).limit(1);
  if (!baseline) return [];
  const candidates = await db
    .select({ mandi: mandisTable, state: statesTable })
    .from(mandisTable)
    .innerJoin(statesTable, eq(mandisTable.stateId, statesTable.id))
    .where(and(eq(mandisTable.stateId, selection.stateId), eq(mandisTable.enabled, true)));
  const costPerKm = Number(process.env.TRANSPORT_COST_PER_QTL_KM ?? 1.8);
  const options = await Promise.all(candidates.map(async ({ mandi }) => {
    const forecast = await forecastForMarket({ commodityId: selection.commodityId, mandiId: mandi.id });
    if (!forecast) return null;
    const km = distanceKm(baseline, mandi);
    const transportCostPerQtl = Math.round(km * costPerKm);
    return {
      mandiId: mandi.id,
      mandiName: mandi.name,
      forecastPricePerQtl: forecast.expectedPrice,
      distanceKm: km,
      transportCostPerQtl,
      netReturnPerQtl: forecast.expectedPrice - transportCostPerQtl,
      isBestOption: false,
      isDemo: true,
    };
  }));
  const available = options.filter((option): option is NonNullable<typeof option> => option !== null)
    .sort((a, b) => b.netReturnPerQtl - a.netReturnPerQtl);
  if (available[0]) available[0].isBestOption = true;
  return available;
}