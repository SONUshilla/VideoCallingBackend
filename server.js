import express from 'express';
import { Server } from "socket.io";
import http from 'http';
import cors from "cors";
import * as mediasoup from "mediasoup";
import "./models/db.js";
import authController from "./Controller/authController.js";
import dashBoardController from "./Controller/dashBoardController.js";
import { initSocket,getIO } from './socket.js';
import { registerMeetingHandlers } from "./Controller/meetingHandlers.js";
import dotenv from "dotenv";
import { getWorker } from './Services/mediasoupServices.js';
import { rooms } from './dataStructures.js';
import { tranportHandlers } from './Controller/transportHandlers.js';
import { createRouter } from './Services/mediasoupServices.js';
dotenv.config();
const app = express();
const server = http.createServer( app);
// ✅ Parse JSON body
app.use(express.json());

// OR with specific options
app.use(cors({
  origin: "*", // allow all origins (not recommended in production)
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use("/auth", authController);
app.use("/user", dashBoardController);

// Initialize Socket.IO once
const io = initSocket(server);
// Store user sessions
const producerToSocket=new Map();

async function initializeMediaSoup()
{
  const worker=await getWorker();
}

// server.js

// Check .env for a flag (default to false if missing)
// In .env, add: SHOW_LOGS=true (for dev) or SHOW_LOGS=false (for prod)
const shouldLog = process.env.SHOW_LOGS === 'true';

if (!shouldLog) {
  console.log = function() {};
  // console.warn = function() {};
}

// Initialize mediasoup and start server
initializeMediaSoup().then(() => {
  io.on("connection", async (socket) => {
    registerMeetingHandlers(socket);    
    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });

  });
  server.listen(3000, () => {
    console.log("Server running on port 3000");
  });
}).catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});