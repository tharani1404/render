import express from "express";
import { createConversation, sendMessage, getMessages, getUserConversations } from "../controllers/chat.controller.js";

const router = express.Router();

router.post("/chat/conversation", createConversation);
router.post("/chat/message", sendMessage);
router.get("/chat/conversation/:userId", getUserConversations);
router.get("/chat/messages/:conversationId", getMessages);

export default router;
