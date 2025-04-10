import { User } from "../models/models.js";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { request } from "express";
import jwt from "jsonwebtoken";

dotenv.config();
export const checkUserExists = async (req, res) => {
    const { phone_no } = req.body;

    if (!phone_no) {
        return res.status(400).json({ success: false, message: "Phone number is required" });
    }

    try {
        const user = await User.findOne({ phone_no });

        if (user) {
            return res.status(200).json({ success: true, message: "User exists", userId: user._id });
        } else {
            return res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (error) {
        console.error("Error checking user existence:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

export const createUser = async (req, res) => {
    console.log(request);
    const { full_name, phone_no, pincode, village_name,topic_of_interests,district } = req.body;

    if (!full_name || !phone_no || !pincode || !village_name ||!district) {
        return res.status(400).json({ success: false, message: "All fields are required" });
    }

    try {
        
        const newUser = new User({ full_name, phone_no, pincode, village_name,topic_of_interests,district });
        await newUser.save();
        const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET);
        res.status(201).json({
            success: true,
            token,
            user: {
              id: newUser._id,
              name: newUser.full_name,
              phone_no: newUser.phone_no,
            },
          });
    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};
export const loginUser = async (req, res) => {
    const { phone_no } = req.body;

    if (!phone_no) {
        return res.status(400).json({ success: false, message: "Phone number is Required" });
    }
    try 
    {
        let user = await User.findOne({ phone_no });
        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET 
        );

        res.status(200).json({
            success: true,
            message: "Login successful",
            token,
            userId: user._id
        });

    } catch (error) {
        console.error("Error logging in:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};


export const updateUser = async (req, res) => {
    const { id } = req.params;
    const { phone_no, ...user } = req.body; 

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(404).json({ success: false, message: "User Not Found" });
    }

    try {
        const existingUser = await User.findById(id);
        if (!existingUser) {
            return res.status(404).json({ success: false, message: "User Not Found" });
        }

        if (phone_no && phone_no !== existingUser.phone_no) {
            const phoneExists = await User.findOne({ phone_no });
            if (phoneExists) {
                return res.status(400).json({
                    success: false,
                    message: "Phone number already in use by another user"
                });
            }
        }
        const updatedUser = await User.findByIdAndUpdate(
            id,
            { ...user, phone_no }, 
            { new: true }
        );

        res.status(200).json({ success: true, data: updatedUser });
    } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};

export const userProfile = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(404).json({ success: false, message: "User Not Found" });
    }

    try {
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User Not Found" });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ success: false, message: "Server Error" });
    }
};
export const getUserPincode = async (req, res) => {
    const { id } = req.params; 
 if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid user ID" });
    }
    try {
        const user = await User.findById(id).select('pincode'); // Only fetch the pincode field
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const pincode = user.pincode || null;
        res.status(200).json({
            success: true,
            message: "User pincode fetched successfully",
            pincode: pincode,
        });
    } 
    catch (error) 
    {
            console.error("Error fetching user pincode:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }

};


export const getCombinedUserData = async (req, res) => {
    const { id } = req.params; // User ID from the request parameters

    try {
        const user = await User.findById(id).select('topic_of_interests pincode'); // Fetch only necessary fields

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const topics = user.topic_of_interests || [];
        const pincode = user.pincode || '';

        res.status(200).json({
            success: true,
            message: "User data fetched successfully",
            topics: topics,
            pincode: pincode,
        });
    } catch (error) {
        console.error("Error fetching user data:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
export const getUser_PhoneNumber = async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    try {
        const user = await User.findById(id).select('phone_no'); 
        if (!user) {
            return res.status(404).json({ success: false, message: "User  not found" });
        }

        res.status(200).json({
            success: true,
            message: "User  phone number fetched successfully",
            phone_no: user.phone_no,
        });
    } catch (error) {
        console.error("Error fetching user phone number:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};