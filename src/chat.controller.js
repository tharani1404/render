import { Conversation, Message } from "../models/models.js";
import mongoose from "mongoose";

export const createConversation = async (req, res) => {
    const { buyer_id, product_id } = req.body;

    if (!buyer_id) {
        return res.status(400).json({ success: false, message: "Buyer ID is required" });
    }

    try {
        let conversation = await Conversation.findOne({ buyer_id, product_id });

        if (!conversation) {
            conversation = new Conversation({ buyer_id, product_id });
            await conversation.save();
        }

        res.status(200).json({ success: true, conversation });
    } catch (error) {
        console.error("Error creating conversation:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

export const sendMessage = async (req, res) => {
    const { conversation_id, sender_id, receiver_id, message_text, message_type } = req.body;

    if (!conversation_id || !sender_id || !receiver_id || !message_text || !message_type) {
        return res.status(400).json({ success: false, message: "All fields are required" });
    }

    try {
        const message = new Message({ conversation_id, sender_id, receiver_id, message_text, message_type });
        await message.save();

        await Conversation.findByIdAndUpdate(conversation_id, { last_message_at: new Date() });

        res.status(201).json({ success: true, message });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};


export const getMessages = async (req, res) => {
    const { conversationId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return res.status(400).json({ success: false, message: "Invalid Conversation ID" });
    }

    try {
        const messages = await Message.find({ conversation_id: conversationId }).sort({ sent_at: 1 });

        res.status(200).json({ success: true, messages });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

export const getUserConversations = async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ success: false, message: "Invalid User ID" });
    }

    try {
        const conversations = await Conversation.find({ buyer_id: userId }).populate("product_id");

        res.status(200).json({ success: true, conversations });
    } catch (error) {
        console.error("Error fetching conversations:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};
