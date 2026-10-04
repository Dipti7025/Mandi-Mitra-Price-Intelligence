import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAdminCatalogEntryBody,
  CreateAdminCatalogEntryResponse,
  GetAdminCatalogResponse,
  GetAdminUsersResponse,
  UpdateAdminCatalogEntryBody,
  UpdateAdminCatalogEntryParams,
  UpdateAdminCatalogEntryResponse,
} from "@workspace/api-zod";
import {
  db,
  commoditiesTable,
  mandisTable,
  statesTable,
  usersTable,
  varietiesTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/auth-session";

const router: IRouter = Router();
type CatalogType = "commodity" | "state" | "mandi" | "variety";

async function catalogEntries() {
  const [commodities, states, mandis, varieties] = await Promise.all([
    db.select().from(commoditiesTable),
    db.select().from(statesTable),
    db.select().from(mandisTable),
    db.select().from(varietiesTable),
  ]);
  return [
    ...commodities.map((entry) => ({
      id: entry.id,
      type: "commodity" as const,
      name: entry.name,
      enabled: entry.enabled,
      code: null,
      stateId: null,
      commodityId: null,
      mandiId: null,
    })),
    ...states.map((entry) => ({
      id: entry.id,
      type: "state" as const,
      name: entry.name,
      enabled: true,
      code: entry.code,
      stateId: null,
      commodityId: null,
      mandiId: null,
    })),
    ...mandis.map((entry) => ({
      id: entry.id,
      type: "mandi" as const,
      name: entry.name,
      enabled: entry.enabled,
      code: null,
      stateId: entry.stateId,
      commodityId: null,
      mandiId: null,
    })),
    ...varieties.map((entry) => ({
      id: entry.id,
      type: "variety" as const,
      name: entry.name,
      enabled: true,
      code: null,
      stateId: null,
      commodityId: entry.commodityId,
      mandiId: entry.mandiId,
    })),
  ].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

function makeId(prefix: string, label: string): string {
  const slug = label.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}-${slug || randomUUID()}`;
}

async function findCatalogEntry(type: CatalogType, id: string) {
  const entries = await catalogEntries();
  return entries.find((entry) => entry.type === type && entry.id === id);
}

router.get("/admin/catalog", requireAdmin, async (_req, res): Promise<void> => {
  res.json(GetAdminCatalogResponse.parse(await catalogEntries()));
});

router.post("/admin/catalog", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateAdminCatalogEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  let id: string;
  try {
    if (input.type === "commodity") {
      id = makeId("commodity", input.name);
      await db.insert(commoditiesTable).values({ id, name: input.name.trim(), enabled: true });
    } else if (input.type === "state") {
      if (!input.code?.trim()) {
        res.status(400).json({ error: "Enter a state or territory code." });
        return;
      }
      id = makeId("state", input.code);
      await db.insert(statesTable).values({ id, name: input.name.trim(), code: input.code.trim().toUpperCase() });
    } else if (input.type === "mandi") {
      if (!input.stateId) {
        res.status(400).json({ error: "Choose a state for this mandi." });
        return;
      }
      const [state] = await db.select().from(statesTable).where(eq(statesTable.id, input.stateId)).limit(1);
      if (!state) {
        res.status(400).json({ error: "Choose a valid state." });
        return;
      }
      id = makeId("mandi", input.name);
      await db.insert(mandisTable).values({
        id,
        name: input.name.trim(),
        stateId: state.id,
        enabled: true,
      });
    } else {
      if (!input.commodityId || !input.mandiId) {
        res.status(400).json({ error: "Choose a commodity and mandi for this variety." });
        return;
      }
      const [[commodity], [mandi]] = await Promise.all([
        db.select().from(commoditiesTable).where(eq(commoditiesTable.id, input.commodityId)).limit(1),
        db.select().from(mandisTable).where(eq(mandisTable.id, input.mandiId)).limit(1),
      ]);
      if (!commodity || !mandi) {
        res.status(400).json({ error: "Choose a valid commodity and mandi." });
        return;
      }
      id = makeId("variety", `${commodity.id}-${mandi.id}-${input.name}`);
      await db.insert(varietiesTable).values({
        id,
        name: input.name.trim(),
        commodityId: commodity.id,
        mandiId: mandi.id,
      });
    }
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.message : "unknown" }, "Catalog entry could not be created");
    res.status(409).json({ error: "That catalog entry could not be created. Check for a duplicate name or code." });
    return;
  }
  const entry = await findCatalogEntry(input.type, id);
  if (!entry) {
    res.status(500).json({ error: "Catalog entry was saved but could not be loaded." });
    return;
  }
  res.status(201).json(CreateAdminCatalogEntryResponse.parse(entry));
});

router.patch("/admin/catalog/:entityType/:entityId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateAdminCatalogEntryParams.safeParse(req.params);
  const parsed = UpdateAdminCatalogEntryBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid update." });
    return;
  }
  const { entityType, entityId } = params.data;
  const input = parsed.data;
  if (entityType === "commodity") {
    const set: Partial<typeof commoditiesTable.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.enabled !== undefined) set.enabled = input.enabled;
    const updated = await db.update(commoditiesTable).set(set).where(eq(commoditiesTable.id, entityId)).returning({ id: commoditiesTable.id });
    if (!updated.length) {
      res.status(404).json({ error: "Commodity not found." });
      return;
    }
  } else if (entityType === "state") {
    if (input.enabled !== undefined) {
      res.status(400).json({ error: "States cannot be enabled or disabled." });
      return;
    }
    const set: Partial<typeof statesTable.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.code !== undefined) set.code = input.code.trim().toUpperCase();
    const updated = await db.update(statesTable).set(set).where(eq(statesTable.id, entityId)).returning({ id: statesTable.id });
    if (!updated.length) {
      res.status(404).json({ error: "State not found." });
      return;
    }
  } else if (entityType === "mandi") {
    const set: Partial<typeof mandisTable.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.enabled !== undefined) set.enabled = input.enabled;
    const updated = await db.update(mandisTable).set(set).where(eq(mandisTable.id, entityId)).returning({ id: mandisTable.id });
    if (!updated.length) {
      res.status(404).json({ error: "Mandi not found." });
      return;
    }
  } else {
    if (input.enabled !== undefined) {
      res.status(400).json({ error: "Varieties cannot be enabled or disabled." });
      return;
    }
    const set: Partial<typeof varietiesTable.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name.trim();
    const updated = await db.update(varietiesTable).set(set).where(eq(varietiesTable.id, entityId)).returning({ id: varietiesTable.id });
    if (!updated.length) {
      res.status(404).json({ error: "Variety not found." });
      return;
    }
  }
  const entry = await findCatalogEntry(entityType, entityId);
  if (!entry) {
    res.status(404).json({ error: "Catalog entry not found." });
    return;
  }
  res.json(UpdateAdminCatalogEntryResponse.parse(entry));
});

router.get("/admin/users", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(500);
  const response = rows.map((user) => ({
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role === "admin" ? "admin" as const : user.role === "trader" ? "trader" as const : "farmer" as const,
    enabled: user.enabled,
    createdAt: user.createdAt,
  }));
  res.json(GetAdminUsersResponse.parse(response));
});

export default router;