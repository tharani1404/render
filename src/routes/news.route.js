import express from "express";
import {
  getNewsArticles,
  getTopicsOfInterest
} from "../controllers/news.controllers.js";

const router = express.Router();

// router.get("/news/:pincode", getNewsByPincode);
router.get('/news/:id/topics', getTopicsOfInterest); // Route to get topics of interest
router.post("/news/feed", getNewsArticles); // Route to get news feed

export default router;