import express from "express";
import { createUser,loginUser,userProfile,updateUser, getUserPincode, getCombinedUserData,checkUserExists,getUser_PhoneNumber } from "../controllers/users.controller.js";
import { authenticate } from "../middleware/authMiddleware.js";
const router=express.Router();

router.post("/users/register",createUser);
router.post("/users/login",loginUser);
router.put("/update/:id", authenticate, updateUser); 
router.get("/profile/:id", authenticate, userProfile); 
router.get("/users/pincode/:id", getUserPincode); 
router.get('/users/combined/:id', getCombinedUserData);
router.post("/check-user", checkUserExists); 
router.get("/users/:id/phone", getUser_PhoneNumber);
export default router;