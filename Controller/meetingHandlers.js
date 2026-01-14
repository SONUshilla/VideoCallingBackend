// server/meetingHandlers.js (or wherever you keep registerMeetingHandlers)
import Meeting from "../models/meeting.js";
import { rooms, socketToRoom, producerToSocket } from "../dataStructures.js";
import { createRouter } from "../Services/mediasoupServices.js";
import { tranportHandlers } from "./transportHandlers.js";

/**
 * registerMeetingHandlers(socket)
 * - All per-socket handlers (chat, typing, room join, disconnect, mediasoup transports)
 * - Chat handlers are registered ONCE (outside joinRoom) and use socketToRoom to resolve room.
 */
export const registerMeetingHandlers = (socket) => {
  /*****************************************
   * Chat handlers — register ONCE per socket
   *****************************************/
  // send_message: server will trust the socket.id and room membership
  socket.on("send_message", (incomingData) => {
    try {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return; // not in a room

      const room = rooms.get(roomId);
      if (!room) return;

      // Use authoritative sender info from room.existingUsers (prevents spoof)
      const user = room.existingUsers.get(socket.id) || {};
      const data = {
        // message payload required by frontend
        message: (incomingData && incomingData.message) || "",
        senderId: socket.id, // override with actual socket id
        username: user.name || incomingData.username || "Unknown",
        userDp: user.profilePic || incomingData.userDp || null,
        timestamp: incomingData?.timestamp || new Date().toISOString(),
      };

      // Emit to everyone EXCEPT the sender. The frontend already adds the message locally.
      socket.to(roomId).emit("receive_message", data);
    } catch (err) {
      console.error("send_message handler failed:", err);
    }
  });

  // typing indicator -> notify others only
  socket.on("typing", ({ senderId, username } = {}) => {
    try {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return;

      // Use authoritative senderId
      socket.to(roomId).emit("user_typing", {
        senderId: socket.id,
        username: username || (rooms.get(roomId)?.existingUsers.get(socket.id)?.name || "Unknown"),
      });
    } catch (err) {
      console.error("typing handler failed:", err);
    }
  });

  // stop_typing -> notify others only
  socket.on("stop_typing", ({ senderId, username } = {}) => {
    try {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return;

      socket.to(roomId).emit("user_stopped_typing", {
        senderId: socket.id,
        username: username || (rooms.get(roomId)?.existingUsers.get(socket.id)?.name || "Unknown"),
      });
    } catch (err) {
      console.error("stop_typing handler failed:", err);
    }
  });

  /*****************************************
   * Meeting / Room handlers
   *****************************************/
  socket.on("createMeeting", async (callback) => {
    try {
      // If you set socket.user earlier (auth middleware), you can use that.
      const newMeeting = await Meeting.create({
        host_id: socket.id,
      });

      if (callback) callback({ meetingId: newMeeting.meeting_id });
    } catch (err) {
      console.error(err);
      if (callback) callback({ error: "Failed to create meeting" });
    }
  });

  socket.on("joinRoom", async ({ roomId, name, profilePic }, callback) => {
    try {
      // Create room if it doesn't exist
      if (!rooms.has(roomId)) {
        const router = await createRouter();

        const audioLevelObserver = await router.createAudioLevelObserver({
          maxEntries: 1,
          threshold: -75,
          interval: 5000,
        });

        audioLevelObserver.on("volumes", (volumes) => {
          if (!volumes.length) return;
          volumes.forEach(({ producer, volume }) => {
            const socketId = producerToSocket.get(producer.id);
            if (!socketId) return;
            socket.in(roomId).emit("ActiveSpeaker", {
              socketId,
              producerId: producer.id,
            });
          });
        });

        audioLevelObserver.on("silence", () => {
          socket.in(roomId).emit("silence");
        });

        rooms.set(roomId, {
          router,
          userSessions: new Map(),
          producers: new Map(),
          audioLevelObserver,
          existingUsers: new Map(),
          host:socket.id
        });
      }

      // Save map from socket -> room and join socket.io room
      socketToRoom.set(socket.id, roomId);
      socket.join(roomId);

      const room = rooms.get(roomId);

      // Create user session for this socket
      room.userSessions.set(socket.id, {
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        rtpCapabilities: null,
      });

      // Add this user to room.existingUsers (authoritative)
      room.existingUsers.set(socket.id, {
        socketId: socket.id,
        name,
        profilePic,
      });

      // Notify others that a new user joined (frontend listens to newUserJoined)
      socket.to(roomId).emit("newUserJoined", {
        socketId: socket.id,
        name,
        profilePic,
      });

      // (Optional) Send current list of existing users to the joining socket
      // Frontend doesn't rely on this necessarily, but it's harmless and useful for other code.
      try {
        const existing = Array.from(room.existingUsers.values());
        socket.emit("existingUsers", existing);
      } catch (err) {
        // ignore
      }

      console.log(`User session created for ${socket.id} in room ${roomId}`);

      // Hook up mediasoup transport handlers (unchanged)
      await tranportHandlers(socket, roomId, profilePic, name, room.audioLevelObserver);

      if (callback) callback();
    } catch (err) {
      console.error("joinRoom failed:", err);
      if (callback) callback({ error: "Failed to join room" });
    }
  });

  /*****************************************
   * Disconnect / cleanup
   *****************************************/
  socket.on("disconnect", () => {
    try {
      console.log("user Disconnected", socket.id);

      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return; // socket never joined a room

      const room = rooms.get(roomId);
      if (!room) return;

      const session = room.userSessions.get(socket.id);
      if (!session) {
        // still remove references if present
        room.existingUsers.delete(socket.id);
        socketToRoom.delete(socket.id);
        return;
      }

      // Get name before deletion to send to others
      const user = room.existingUsers.get(socket.id);

      // Notify others that user left (frontend listens to userLeft)
      socket.to(roomId).emit("userLeft", {
        socketId: socket.id,
        name: user?.name || "Unknown",
      });
      socket.to(roomId).emit("userDisconnected", { socketId: socket.id });
      // cleanup producers (close and notify)
      session.producers.forEach((producer, producerId) => {
        try { producer.close(); } catch (e) {}
        room.producers.delete(producerId);
        socket.to(roomId).emit("producer-closed", { producerId });
      });

      // cleanup consumers
      session.consumers.forEach((consumer) => {
        try { consumer.close(); } catch (e) {}
      });

      // cleanup transports
      session.transports.forEach((transport) => {
        try { transport.close(); } catch (e) {}
      });

      // remove session & maps
      room.userSessions.delete(socket.id);
      socketToRoom.delete(socket.id);
      room.existingUsers.delete(socket.id);

      console.log("Cleanup complete for socket:", socket.id);
    } catch (err) {
      console.error("Error during disconnect cleanup:", err);
    }
  });
};
