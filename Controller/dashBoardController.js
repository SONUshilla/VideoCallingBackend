import express from "express";
import User from "../models/user.js";
import { verifyJWT } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/dashboard", verifyJWT, async (req, res) => {
  try {
   
    const id = req.user.id;
    
    // Await the database query
    const user = await User.findOne({ _id: id });

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
