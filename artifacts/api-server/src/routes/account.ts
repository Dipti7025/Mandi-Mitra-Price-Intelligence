import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateAlertBody,
  CreateAlertResponse,
  DeleteAlertParams,
  GetAlertsResponse,
  GetProfileResponse,
  RequestPhoneOtpBody,
  RequestPhoneOtpResponse,
  UpdateAlertBody,
  UpdateAlertParams,
  UpdateAlertResponse,
  UpdateProfileBody,
  UpdateProfileResponse,
  VerifyPhoneOtpBody,
  VerifyPhoneOtpResponse,
} from "@workspace/api-zod";
import {
  db,
  adminUsersTable,
  commoditiesTable,
  mandisTable,
  marketPricesTable,
  otpChallengesTable,
  priceAlertsTable,
  usersTable,
} from "@workspace/db";
import {
  adminPhoneAllowed,
  checkOtp,
  createOtp,
  issueSession,
  otpExpiration,
  requireAuth,
  revokeSession,
} from "../lib/auth-session";

const router: IRouter = Router();
const phonePattern = /^\+91[6-9]\d{9}$/;

async function profilePayload(user: typeof usersTable.$inferSelect) {
  const [preferredMandi] = user.preferredMandiId
    ? await db.select({ stateId: mandisTable.stateId }).from(mandisTable).where(eq(mandisTable.id, user.preferredMandiId)).limit(1)
    : [];
  return {
    id: user.id,
    phone: user.phone,
    name: user.name,
    preferredCommodityId: user.preferredCommodityId,
    preferredMandiId: user.preferredMandiId,
    preferredStateId: preferredMandi?.stateId ?? null,
    role: user.role === "admin" ? "admin" as const : user.role === "trader" ? "trader" as const : "farmer" as const,
  };
}

router.post("/auth/otp/request", async (req, res): Promise<void> => {
  const parsed = RequestPhoneOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (process.env.NODE_ENV === "production") {
    res.status(503).json({ error: "Phone verification is not available yet because an SMS provider has not been configured." });
    return;
  }
  if (!process.env.SESSION_SECRET) {
    res.status(503).json({ error: "Phone verification needs a secure session secret." });
    return;
  }
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const [recentCount] = await db
    .select({ value: count() })
    .from(otpChallengesTable)
    .where(and(
      eq(otpChallengesTable.phone, parsed.data.phone),
      gt(otpChallengesTable.createdAt, cutoff),
    ));
  if (Number(recentCount?.value ?? 0) >= 3) {
    res.status(429).json({ error: "Too many code requests. Please try again later." });
    return;
  }
  const otp = createOtp();
  await db.insert(otpChallengesTable).values({
    id: randomUUID(),
    phone: parsed.data.phone,
    codeHash: otp.codeHash,
    expiresAt: otpExpiration(),
  });
  res.json(RequestPhoneOtpResponse.parse({
    sent: true,
    developmentCode: otp.code,
    expiresInSeconds: 300,
  }));
});

router.post("/auth/otp/verify", async (req, res): Promise<void> => {
  const parsed = VerifyPhoneOtpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [challenge] = await db.select().from(otpChallengesTable).where(and(
    eq(otpChallengesTable.phone, parsed.data.phone),
    isNull(otpChallengesTable.usedAt),
    gt(otpChallengesTable.expiresAt, new Date()),
  )).orderBy(desc(otpChallengesTable.createdAt)).limit(1);
  if (!challenge || challenge.attempts >= 5) {
    res.status(401).json({ error: "That code has expired. Request a new code and try again." });
    return;
  }
  await db.update(otpChallengesTable)
    .set({ attempts: challenge.attempts + 1 })
    .where(and(eq(otpChallengesTable.id, challenge.id), isNull(otpChallengesTable.usedAt)));
  if (!checkOtp(parsed.data.code, challenge.codeHash)) {
    res.status(401).json({ error: "That code is not correct. Please try again." });
    return;
  }
  await db.update(otpChallengesTable)
    .set({ usedAt: new Date() })
    .where(and(eq(otpChallengesTable.id, challenge.id), isNull(otpChallengesTable.usedAt)));

  const isAdmin = adminPhoneAllowed(parsed.data.phone);
  const [user] = await db.insert(usersTable).values({
    id: randomUUID(),
    phone: parsed.data.phone,
    role: isAdmin ? "admin" : "farmer",
  }).onConflictDoUpdate({
    target: usersTable.phone,
    set: { role: isAdmin ? "admin" : "farmer", enabled: true },
  }).returning();
  if (!user) {
    res.status(500).json({ error: "Unable to create your account right now." });
    return;
  }
  if (isAdmin) {
    await db.insert(adminUsersTable).values({ userId: user.id }).onConflictDoUpdate({
      target: adminUsersTable.userId,
      set: { enabled: true },
    });
  } else {
    await db.delete(adminUsersTable).where(eq(adminUsersTable.userId, user.id));
  }
  await issueSession(user.id, res);
  res.json(VerifyPhoneOtpResponse.parse(await profilePayload(user)));
});

router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  if (!req.currentUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  res.json(GetProfileResponse.parse(await profilePayload(req.currentUser)));
});

router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!req.currentUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim() || null;
  if (parsed.data.preferredCommodityId === null) {
    updates.preferredCommodityId = null;
  } else if (parsed.data.preferredCommodityId !== undefined) {
    const [commodity] = await db.select().from(commoditiesTable).where(and(
      eq(commoditiesTable.id, parsed.data.preferredCommodityId),
      eq(commoditiesTable.enabled, true),
    )).limit(1);
    if (!commodity) {
      res.status(400).json({ error: "Choose a commodity that is currently available." });
      return;
    }
    updates.preferredCommodityId = commodity.id;
  }
  if (parsed.data.preferredMandiId === null) {
    updates.preferredMandiId = null;
  } else if (parsed.data.preferredMandiId !== undefined) {
    const [mandi] = await db.select().from(mandisTable).where(and(
      eq(mandisTable.id, parsed.data.preferredMandiId),
      eq(mandisTable.enabled, true),
    )).limit(1);
    if (!mandi) {
      res.status(400).json({ error: "Choose a mandi that is currently available." });
      return;
    }
    updates.preferredMandiId = mandi.id;
  }
  if (req.currentUser.role !== "admin" && (parsed.data.role === "farmer" || parsed.data.role === "trader")) {
    updates.role = parsed.data.role;
  }
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.currentUser.id)).returning();
  if (!user) {
    res.status(404).json({ error: "Profile not found." });
    return;
  }
  res.json(UpdateProfileResponse.parse(await profilePayload(user)));
});

async function alertPayload(
  alert: typeof priceAlertsTable.$inferSelect,
  commodityName: string,
  mandiName: string,
) {
  const [latestPrice] = await db.select().from(marketPricesTable).where(and(
    eq(marketPricesTable.commodityId, alert.commodityId),
    eq(marketPricesTable.mandiId, alert.mandiId),
  )).orderBy(desc(marketPricesTable.marketDate)).limit(1);
  const currentPrice = latestPrice ? Number(latestPrice.modalPrice) : null;
  const targetPrice = Number(alert.targetPrice);
  const targetReached = alert.active && currentPrice !== null
    && (alert.direction === "above" ? currentPrice >= targetPrice : currentPrice <= targetPrice);
  return {
    id: alert.id,
    commodityId: alert.commodityId,
    commodityName,
    mandiId: alert.mandiId,
    mandiName,
    targetPrice,
    direction: alert.direction,
    channel: "app" as const,
    active: alert.active,
    currentPrice,
    targetReached,
    priceDataIsDemo: latestPrice?.isDemo ?? false,
  };
}

router.get("/alerts", requireAuth, async (req, res): Promise<void> => {
  if (!req.currentUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const rows = await db
    .select({
      alert: priceAlertsTable,
      commodityName: commoditiesTable.name,
      mandiName: mandisTable.name,
    })
    .from(priceAlertsTable)
    .innerJoin(commoditiesTable, eq(priceAlertsTable.commodityId, commoditiesTable.id))
    .innerJoin(mandisTable, eq(priceAlertsTable.mandiId, mandisTable.id))
    .where(eq(priceAlertsTable.userId, req.currentUser.id))
    .orderBy(desc(priceAlertsTable.createdAt));
  const response = await Promise.all(rows.map(({ alert, commodityName, mandiName }) =>
    alertPayload(alert, commodityName, mandiName)));
  res.json(GetAlertsResponse.parse(response));
});

router.post("/alerts", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateAlertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!req.currentUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const [market] = await db.select().from(marketPricesTable).where(and(
    eq(marketPricesTable.commodityId, parsed.data.commodityId),
    eq(marketPricesTable.mandiId, parsed.data.mandiId),
  )).limit(1);
  if (!market) {
    res.status(400).json({ error: "This commodity is not listed at the selected mandi." });
    return;
  }
  const [alert] = await db.insert(priceAlertsTable).values({
    id: randomUUID(),
    userId: req.currentUser.id,
    ...parsed.data,
    targetPrice: String(parsed.data.targetPrice),
  }).returning();
  if (!alert) {
    res.status(500).json({ error: "Unable to save this alert." });
    return;
  }
  const [mandi] = await db.select().from(mandisTable).where(eq(mandisTable.id, alert.mandiId)).limit(1);
  const commodity = (await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, alert.commodityId)).limit(1))[0];
  const response = await alertPayload(alert, commodity?.name ?? "", mandi?.name ?? "");
  res.status(201).json(CreateAlertResponse.parse(response));
});

router.patch("/alerts/:alertId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAlertParams.safeParse(req.params);
  const parsed = UpdateAlertBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: params.error?.message ?? parsed.error?.message ?? "Invalid alert update." });
    return;
  }
  if (!req.currentUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const update: Partial<typeof priceAlertsTable.$inferInsert> = {};
  if (parsed.data.targetPrice !== undefined) update.targetPrice = String(parsed.data.targetPrice);
  if (parsed.data.direction !== undefined) update.direction = parsed.data.direction;
  if (parsed.data.channel !== undefined) update.channel = parsed.data.channel;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;
  const [alert] = await db.update(priceAlertsTable).set(update).where(and(
    eq(priceAlertsTable.id, params.data.alertId),
    eq(priceAlertsTable.userId, req.currentUser.id),
  )).returning();
  if (!alert) {
    res.status(404).json({ error: "Alert not found." });
    return;
  }
  const [commodity] = await db.select().from(commoditiesTable).where(eq(commoditiesTable.id, alert.commodityId)).limit(1);
  const [mandi] = await db.select().from(mandisTable).where(eq(mandisTable.id, alert.mandiId)).limit(1);
  res.json(UpdateAlertResponse.parse(await alertPayload(alert, commodity?.name ?? "", mandi?.name ?? "")));
});

router.delete("/alerts/:alertId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteAlertParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!req.currentUser) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }
  const deleted = await db.delete(priceAlertsTable).where(and(
    eq(priceAlertsTable.id, params.data.alertId),
    eq(priceAlertsTable.userId, req.currentUser.id),
  )).returning({ id: priceAlertsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Alert not found." });
    return;
  }
  res.sendStatus(204);
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeSession(req, res);
  res.sendStatus(204);
});

export default router;