import express from "express";

import {
  sendmail,
  updateAnalytics,
} from "../controllers/askyourneta.controller.js";

const router = express.Router();
router.post("/askquery", sendmail);
router.post("/getanalytics", updateAnalytics);
export default router;