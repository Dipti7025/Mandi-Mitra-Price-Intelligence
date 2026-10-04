import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CompareMandisQueryParams,
  CompareMandisResponse,
  GetCommoditiesResponse,
  GetMarketForecastQueryParams,
  GetMarketForecastResponse,
  GetMarketTodayQueryParams,
  GetMarketTodayResponse,
  GetMandisQueryParams,
  GetMandisResponse,
  GetStatesQueryParams,
  GetStatesResponse,
  GetVarietiesQueryParams,
  GetVarietiesResponse,
} from "@workspace/api-zod";
import {
  db,
  commoditiesTable,
  mandisTable,
  marketPricesTable,
  statesTable,
  varietiesTable,
} from "@workspace/db";
import { compareMarketReturns, forecastForMarket, getMarketHistory, marketToday } from "../lib/market-intel";

const router: IRouter = Router();

router.get("/market-data/commodities", async (_req, res): Promise<void> => {
  const rows = await db
    .selectDistinct({ id: commoditiesTable.id, name: commoditiesTable.name, enabled: commoditiesTable.enabled })
    .from(commoditiesTable)
    .innerJoin(marketPricesTable, eq(marketPricesTable.commodityId, commoditiesTable.id))
    .innerJoin(mandisTable, eq(marketPricesTable.mandiId, mandisTable.id))
    .where(and(eq(commoditiesTable.enabled, true), eq(mandisTable.enabled, true)))
    .orderBy(commoditiesTable.name);
  res.json(GetCommoditiesResponse.parse(rows));
});

router.get("/market-data/states", async (req, res): Promise<void> => {
  const parsed = GetStatesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .selectDistinct({ id: statesTable.id, name: statesTable.name, code: statesTable.code })
    .from(marketPricesTable)
    .innerJoin(commoditiesTable, eq(marketPricesTable.commodityId, commoditiesTable.id))
    .innerJoin(mandisTable, eq(marketPricesTable.mandiId, mandisTable.id))
    .innerJoin(statesTable, eq(mandisTable.stateId, statesTable.id))
    .where(and(
      eq(marketPricesTable.commodityId, parsed.data.commodityId),
      eq(mandisTable.enabled, true),
      eq(commoditiesTable.enabled, true),
    ));
  res.json(GetStatesResponse.parse(rows));
});

router.get("/market-data/mandis", async (req, res): Promise<void> => {
  const parsed = GetMandisQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .selectDistinct({
      id: mandisTable.id,
      name: mandisTable.name,
      stateId: statesTable.id,
      stateName: statesTable.name,
    })
    .from(marketPricesTable)
    .innerJoin(commoditiesTable, eq(marketPricesTable.commodityId, commoditiesTable.id))
    .innerJoin(mandisTable, eq(marketPricesTable.mandiId, mandisTable.id))
    .innerJoin(statesTable, eq(mandisTable.stateId, statesTable.id))
    .where(and(
      eq(marketPricesTable.commodityId, parsed.data.commodityId),
      eq(statesTable.id, parsed.data.stateId),
      eq(mandisTable.enabled, true),
    ));
  const withDistance = rows.map((row) => ({ ...row, distanceKm: 0 }));
  res.json(GetMandisResponse.parse(withDistance));
});

router.get("/market-data/varieties", async (req, res): Promise<void> => {
  const parsed = GetVarietiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await db
    .selectDistinct({
      id: varietiesTable.id,
      name: varietiesTable.name,
      commodityId: varietiesTable.commodityId,
      mandiId: varietiesTable.mandiId,
    })
    .from(varietiesTable)
    .innerJoin(marketPricesTable, eq(marketPricesTable.varietyId, varietiesTable.id))
    .where(and(
      eq(varietiesTable.commodityId, parsed.data.commodityId),
      eq(varietiesTable.mandiId, parsed.data.mandiId),
    ));
  res.json(GetVarietiesResponse.parse(rows));
});

router.get("/market-data/today", async (req, res): Promise<void> => {
  const parsed = GetMarketTodayQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const history = await getMarketHistory(parsed.data, 1);
  const latest = history[0];
  if (!latest) {
    res.status(404).json({ error: "Market data is currently unavailable for this selection. Please try another mandi." });
    return;
  }
  const variety = parsed.data.varietyId
    ? await db.select().from(varietiesTable).where(eq(varietiesTable.id, parsed.data.varietyId)).limit(1)
    : [];
  res.json(GetMarketTodayResponse.parse(marketToday(latest, variety[0]?.name ?? null)));
});

router.get("/market-data/forecast", async (req, res): Promise<void> => {
  const parsed = GetMarketForecastQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const forecast = await forecastForMarket(parsed.data);
  if (!forecast) {
    res.status(404).json({ error: "7-day forecast is currently unavailable. Please check again later." });
    return;
  }
  res.json(GetMarketForecastResponse.parse(forecast));
});

router.get("/market-data/compare", async (req, res): Promise<void> => {
  const parsed = CompareMandisQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const options = await compareMarketReturns({
    commodityId: parsed.data.commodityId,
    mandiId: parsed.data.mandiId,
    stateId: parsed.data.stateId,
    quantityQtl: parsed.data.quantityQtl,
  });
  res.json(CompareMandisResponse.parse(options));
});

export default router;