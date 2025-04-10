import axios from "axios";
import mongoose from "mongoose"; // Add mongoose import
import { User } from "../models/models.js"; // Import User model

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';

export const getTopicsOfInterest = async (req, res) => {
    console.log("Fetching topics of interest...");
    const { id } = req.params;
    console.log("User ID:", id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    try {
        const user = await User.findById(id).select('topic_of_interests');

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const topics = user.topic_of_interests;

        res.status(200).json({
            success: true,
            message: "Topics of interest fetched successfully",
            topics: topics,
        });
    } catch (error) {
        console.error("Error fetching topics of interest:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const getNewsArticles = async (req, res) => {
    try {
        const searchQuery = req.body.query;

        if (!searchQuery) {
            return res.status(400).json({ success: false, message: "Search query is required" });
        }

        console.log("Sending Search Query to Python Service:", searchQuery);

        try {
            const response = await axios.post(`${PYTHON_SERVICE_URL}/search`, {
                query: searchQuery
            }, {
                timeout: 30000 // 30 second timeout
            });

            console.log("Received Python Results:", response.data);

            res.status(200).json({
                success: true,
                data: response.data,
                message: "News articles fetched successfully"
            });

        } catch (pythonError) {
            console.error('Error calling Python service:', pythonError.message);

            if (pythonError.response) {
                return res.status(pythonError.response.status).json({
                    success: false,
                    message: `Python service error: ${pythonError.response.data.error || 'Unknown error'}`
                });
            }

            return res.status(500).json({ success: false, message: 'Python service unavailable' });
        }

    } catch (error) {
        console.error("Error in getNewsArticles route:", error);
        res.status(500).json({ success: false, message: "Failed to fetch news articles", error: error.message });
    }
};