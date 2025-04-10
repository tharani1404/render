import express from "express";

import { sendmail, fetchUpdatedResponses } from "../controllers/askyourneta.controller.js";

const router = express.Router();
router.post("/askquery", sendmail);
router.post("/getanalytics", fetchUpdatedResponses);

export default router;