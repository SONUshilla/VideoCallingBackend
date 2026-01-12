import { OAuth2Client } from "google-auth-library";
import User from "../models/user.js";
import express from "express";  // import express
import jwt from "jsonwebtoken";
import { verifyJWT } from "../Middlewares/authMiddleware.js";

const router = express.Router();  // ✅ create router instance

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post("/google", async (req, res) => {
  const { token } = req.body;

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    const user = {
      name: payload.name,
      email: payload.email,
      profilePic: payload.picture,
    };

    const existingUser = await User.findOneAndUpdate(
        { email: user.email }, // find query
        user,                        // data to insert/update
        { upsert: true, new: true }  // create if not exists, return the new document
      );   
        // Create JWT
        const jwtToken = jwt.sign(
            { id: existingUser._id, email: existingUser.email },
            process.env.JWT_SECRET,
            { expiresIn: "7d" } // token expires in 7 days
          );
          console.log("jwt token",jwtToken)
          res.json({ token: jwtToken, user:existingUser });
  } catch (error) {
    console.error(error);
    res.status(401).json({ error: "Invalid token" });
  }
});

router.get("/verifyToken", verifyJWT, async (req, res) => {
  
  if (req.user) {
      const id = req.user.id;
      // Await the database query
      const user = await User.findOne({ _id: id });
      return res.status(200).json({ message: "Token valid", user: user });
  } else {
      return res.status(401).json({ message: "Invalid token" });
  }
});


export default router;
