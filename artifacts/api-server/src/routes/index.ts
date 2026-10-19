import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tournamentRouter from "./tournament";
import teamEventRouter from "./team-event";
import breakoutRouter from "./breakout";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tournamentRouter);
router.use(teamEventRouter);
router.use(breakoutRouter);

export default router;
