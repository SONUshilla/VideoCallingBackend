// socket.js
import { Server } from "socket.io";
import jwt from 'jsonwebtoken';
let io = null; // will be assigned later

export function initSocket(server) {
    io = new Server(server, {
        cors: {
            origin: "*",
        },
    });

    io.on("connection", (socket) => {
        console.log("User connected:", socket.id);
    });
    
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token?.trim();
    
        if (!token) {
          return next(new Error("Authentication error"));
        }
    
        try {
            const user = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = user; 
            next();
        } catch (err) {
            console.error("JWT verification failed:", err.message, err);
            next(new Error("Authentication error"));
        }
    });
    

    return io;
}

export function getIO() {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
}
