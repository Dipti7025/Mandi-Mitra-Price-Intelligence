import { randomUUID } from "node:crypto";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminMarketRecordBody,
  CreateAdminMarketRecordResponse,
  DeleteAdminMarketRecordParams,
  GetAdminMarketRecordsQueryParams,
  GetAdminMarketRecordsResponse,
  GetAdminOverviewResponse,
  GetDataHealthResponse,
  ImportAdminMarketRecordsBody,
  ImportAdminMarketRecordsResponse,
  UpdateAdminMarketRecordBody,
  UpdateAdminMarketRecordParams,
  UpdateAdminMarketRecordResponse,
} from "@workspace/api-zod";
import {
  db,
  commoditiesTable,
  importJobsTable,
  mandisTable,
  marketPricesTable,
  statesTable,
  usersTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/auth-session";

const router: IRouter = Router();

function recordPayload(row: {
  price: typeof marketPricesTable.$inferSelect;
  commodityName: string;
  mandiName: string;
}) {
  return {
    id: row.price.id,
    commodityId: row.price.commodityId,
    commodityName: row.commodityName,
    mandiId: row.price.mandiId,
    mandiName: row.mandiName,
    date: row.price.marketDate,
    minimumPrice: Number(row.price.minimumPrice),
    maximumPrice: Number(row.price.maximumPrice),
    modalPrice: Number(row.price.modalPrice),
    arrivals: Number(row.price.arrivals),
    arrivalUnit: row.price.arrivalUnit,
    source: row.price.source,
    isDemo: row.price.isDemo,
  };
}

router.get("/admin/overview", requireAdmin, async (_req, res): Promise<void> => {
  const [[users], [commodities], [mandis], [todayRecords], [latest]] = await Promise.all([
    db.select({ value: count() }).from(usersTable),
    db.select({ value: count() }).from(commoditiesTable).where(eq(commoditiesTable.enabled, true)),
    db.select({ value: count() }).from(mandisTable).where(eq(mandisTable.enabled, true)),
    db.select({ value: count() }).from(marketPricesTable).where(eq(marketPricesTable.marketDate, new Date().toISOString().slice(0, 10))),
    db.select({ value: marketPricesTable.lastUpdated }).from(marketPricesTable).orderBy(desc(marketPricesTable.lastUpdated)).limit(1),
  ]);
  res.json(GetAdminOverviewResponse.parse({
    totalUsers: Number(users?.value ?? 0),
    totalCommodities: Number(commodities?.value ?? 0),
    totalMandis: Number(mandis?.value ?? 0),
    todayRecords: Number(todayRecords?.value ?? 0),
    lastUpdated: latest?.value ?? null,
  }));
});

router.get("/admin/market-records", requireAdmin, async (req, res): Promise<void> => {
  const parsed = GetAdminMarketRecordsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const search = parsed.data.search?.trim();
  const rows = await db
    .select({
      price: marketPricesTable,
      commodityName: commoditiesTable.name,
      mandiName: mandisTable.name,
    })
    .from(marketPricesTable)
    .innerJoin(commoditiesTable, eq(marketPricesTable.commodityId, commoditiesTable.id))
    .innerJoin(mandisTable, eq(marketPricesTable.mandiId, mandisTable.id))
    .where(search
      ? or(ilike(commoditiesTable.name, `%${search}%`), ilike(mandisTable.name, `%${search}%`))
      : undefined)
    .orderBy(desc(marketPricesTable.marketDate))
    .limit(250);
  res.json(GetAdminMarketRecordsResponse.parse(rows.map(recordPayload)));
});

router.post("/admin/market-records", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateAdminMarketRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (input.minimumPrice > input.modalPrice || input.modalPrice > input.maximumPrice) {
    res.status(400).json({ error: "Price must fall between the minimum and maximum." });
    return;
  }
  const [commodity] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, input.commodityId)).limit(1);
  const [mandi] = await db.select().from(mandisTable).where(eq(mandisTable.id, input.mandiId)).limit(1);
  if (!commodity || !mandi) {
    res.status(400).json({ error: "Select a valid commodity and mandi." });
    return;
  }
  const [price] = await db.insert(marketPricesTable).values({
    id: randomUUID(),
    commodityId: input.commodityId,
    mandiId: input.mandiId,
    marketDate: input.date.toISOString().slice(0, 10),
    minimumPrice: String(input.minimumPrice),
    maximumPrice: String(input.maximumPrice),
    modalPrice: String(input.modalPrice),
    arrivals: String(input.arrivals),
    arrivalUnit: input.arrivalUnit,
    source: input.source,
    isDemo: false,
  }).returning();
  if (!price) {
    res.status(500).json({ error: "Unable to save this market record." });
    return;
  }
  res.status(201).json(CreateAdminMarketRecordResponse.parse(recordPayload({
    price,
    commodityName: commodity.name,
    mandiName: mandi.name,
  })));
});

router.patch("/admin/market-records/:recordId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAdminMarketRecordParams.safeParse(req.params);
  const parsed = UpdateAdminMarketRecordBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid update." });
    return;
  }
  const input = parsed.data;
  const [existing] = await db.select().from(marketPricesTable)
    .where(eq(marketPricesTable.id, params.data.recordId)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Market record not found." });
    return;
  }
  const minimum = input.minimumPrice ?? Number(existing.minimumPrice);
  const maximum = input.maximumPrice ?? Number(existing.maximumPrice);
  const modal = input.modalPrice ?? Number(existing.modalPrice);
  if (minimum > modal || modal > maximum) {
    res.status(400).json({ error: "Typical price must fall between the minimum and maximum." });
    return;
  }
  const set: Partial<typeof marketPricesTable.$inferInsert> = {};
  if (input.minimumPrice !== undefined) set.minimumPrice = String(input.minimumPrice);
  if (input.maximumPrice !== undefined) set.maximumPrice = String(input.maximumPrice);
  if (input.modalPrice !== undefined) set.modalPrice = String(input.modalPrice);
  if (input.arrivals !== undefined) set.arrivals = String(input.arrivals);
  if (input.source !== undefined) set.source = input.source;
  set.isDemo = false;
  set.lastUpdated = new Date();
  const [price] = await db.update(marketPricesTable).set(set)
    .where(eq(marketPricesTable.id, params.data.recordId)).returning();
  if (!price) {
    res.status(404).json({ error: "Market record not found." });
    return;
  }
  const [[commodity], [mandi]] = await Promise.all([
    db.select().from(commoditiesTable).where(eq(commoditiesTable.id, price.commodityId)).limit(1),
    db.select().from(mandisTable).where(eq(mandisTable.id, price.mandiId)).limit(1),
  ]);
  res.json(UpdateAdminMarketRecordResponse.parse(recordPayload({
    price,
    commodityName: commodity?.name ?? "",
    mandiName: mandi?.name ?? "",
  })));
});

router.delete("/admin/market-records/:recordId", requireAdmin, async (req, res): Promise<void> => {
  const params = DeleteAdminMarketRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const deleted = await db.delete(marketPricesTable).where(eq(marketPricesTable.id, params.data.recordId))
    .returning({ id: marketPricesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Market record not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/admin/market-records/import", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ImportAdminMarketRecordsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!req.currentUser) {
    res.status(401).json({ error: "Admin access is required." });
    return;
  }
  const errors: string[] = [];
  let imported = 0;
  for (const [index, input] of parsed.data.records.entries()) {
    if (input.minimumPrice > input.modalPrice || input.modalPrice > input.maximumPrice) {
      errors.push(`Row ${index + 1}: modal price must be between minimum and maximum.`);
      continue;
    }
    try {
      await db.insert(marketPricesTable).values({
        id: randomUUID(),
        commodityId: input.commodityId,
        mandiId: input.mandiId,
        marketDate: input.date.toISOString().slice(0, 10),
        minimumPrice: String(input.minimumPrice),
        maximumPrice: String(input.maximumPrice),
        modalPrice: String(input.modalPrice),
        arrivals: String(input.arrivals),
        arrivalUnit: input.arrivalUnit,
        source: input.source,
        isDemo: false,
      });
      imported += 1;
    } catch (error) {
      errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : "record could not be saved."}`);
    }
  }
  const rejected = parsed.data.records.length - imported;
  await db.insert(importJobsTable).values({
    id: randomUUID(),
    adminUserId: req.currentUser.id,
    status: rejected > 0 ? (imported > 0 ? "partial" : "failed") : "complete",
    importedCount: imported,
    rejectedCount: rejected,
    errors,
  });
  res.json(ImportAdminMarketRecordsResponse.parse({ imported, rejected, errors }));
});

router.get("/admin/data-health", requireAdmin, async (_req, res): Promise<void> => {
  const [[records], [failedImports], [latest], pairs, expectedPairs, [demoRows]] = await Promise.all([
    db.select({ value: count() }).from(marketPricesTable),
    db.select({ value: count() }).from(importJobsTable).where(eq(importJobsTable.status, "failed")),
    db.select({ value: marketPricesTable.lastUpdated }).from(marketPricesTable).orderBy(desc(marketPricesTable.lastUpdated)).limit(1),
    db.selectDistinct({ commodityId: marketPricesTable.commodityId, mandiId: marketPricesTable.mandiId })
      .from(marketPricesTable),
    db.selectDistinct({ commodityId: commoditiesTable.id, mandiId: mandisTable.id })
      .from(commoditiesTable)
      .innerJoin(marketPricesTable, eq(marketPricesTable.commodityId, commoditiesTable.id))
      .innerJoin(mandisTable, eq(marketPricesTable.mandiId, mandisTable.id))
      .where(and(eq(commoditiesTable.enabled, true), eq(mandisTable.enabled, true))),
    db.select({ value: count() }).from(marketPricesTable).where(eq(marketPricesTable.isDemo, true)),
  ]);
  const lastSuccessfulUpdate = latest?.value ?? null;
  const isCurrent = !!lastSuccessfulUpdate && Date.now() - lastSuccessfulUpdate.getTime() < 24 * 60 * 60 * 1000;
  res.json(GetDataHealthResponse.parse({
    lastSuccessfulUpdate,
    missingDataCount: Math.max(0, expectedPairs.length - pairs.length),
    failedImports: Number(failedImports?.value ?? 0),
    recordCount: Number(records?.value ?? 0),
    freshness: Number(demoRows?.value ?? 0) > 0 ? "demo" : isCurrent ? "current" : "outdated",
    marketProviderConfigured: false,
    forecastProviderConfigured: false,
    otpProviderConfigured: false,
  }));
});

export default router;