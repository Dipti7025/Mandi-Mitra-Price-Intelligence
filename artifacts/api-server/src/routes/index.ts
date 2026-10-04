import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketDataRouter from "./market-data";
import accountRouter from "./account";
import adminRouter from "./admin";
import adminCatalogRouter from "./admin-catalog";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketDataRouter);
router.use(accountRouter);
router.use(adminRouter);
router.use(adminCatalogRouter);

export default router;
