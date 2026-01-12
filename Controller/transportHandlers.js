import { rooms,producerToSocket } from "../dataStructures.js";
import { createRouter } from "../Services/mediasoupServices.js";
import { getContext } from "../dataStructures.js";
export const tranportHandlers = async (socket, roomId, profilePic, name,audioLevelObserver) => {
  if (socket.hasHandlers) {
    console.log("Handlers already registered for this socket");
    return;
  }
  socket.hasHandlers = true;

  // Join Socket.IO room
  const { router, userSessions, producers, existingUsers } =getContext(roomId);

  // 2. Create WebRTC send transport
  socket.on("create-send-transport", async (callback) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }], // Use your actual IP in production
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        iceLite: false,
        initialAvailableOutgoingBitrate: 1000000,
      });

      const userSession = userSessions.get(socket.id);
      userSession.transports.set("send", transport);
      transport.on("dtlsstatechange", (dtlsState) => {
        console.log("Server recv transport DTLS state:", dtlsState);
        if (dtlsState === "failed") {
          console.error("SERVER ERROR: DTLS failed");
        }
      });
      const transportParams = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };

      socket.emit("send-transport-created", transportParams);
      if (callback) callback({ status: "ok", transport: transportParams });
    } catch (error) {
      console.error("Error creating send transport:", error);
      if (callback) callback({ status: "error", error: error.message });
    }
  });
  // Handle produce event from client
  socket.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
    try {
      const userSession = userSessions.get(socket.id);
      console.log(
        `Produce event - kind: ${kind}, socket: ${socket.id}, tag: ${appData?.mediaTag}`
      );
  
      const transport = userSession.transports.get("send");
  
      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData // ✅ IMPORTANT
      });
  
      userSession.producers.set(producer.id, producer);
      producerToSocket.set(producer.id, socket.id);
  
      producers.set(producer.id, {
        producer,
        socketId: socket.id,
        appData
      });
  
      // 🔊 Audio level observer
      if (producer.kind === "audio" && audioLevelObserver) {
        await audioLevelObserver.addProducer({ producerId: producer.id });
      }
  
      // 🖥️ Screen share detection
      if (producer.kind === "video" && appData?.mediaTag === "screen") {
        console.log(`🖥️ Screen sharing started by ${socket.id}`);
        userSession.screenProducerId = producer.id;
      }
  
      // 🔥 Notify other peers WITH metadata
      socket.to(roomId).emit("newProducer", {
        socketId: socket.id,
        producerId: producer.id,
        appData
      });
  
      producer.on("transportclose", () => {
        console.log(`Producer transport closed - id: ${producer.id}`);
  
        if (producer.appData?.mediaTag === "screen") {
          console.log(`🛑 Screen sharing stopped by ${socket.id}`);
          userSession.screenProducerId = null;
        }
        userSession.producers.delete(producer.id);
      });
  
      producer.on("close", () => {
        console.log("the screen share is stopped")
        if (producer.appData?.mediaTag === "screen") {
          userSession.screenProducerId = null;
        }
      });
  
      callback({ id: producer.id });
    } catch (error) {
      console.error("Error in produce:", error);
      errback?.(error);
    }
  });
  

  socket.on("transport-connect", async ({ dtlsParameters }, callback) => {
    try {
      console.log(`Transport connect attempt for socket: ${socket.id}`);

      const userSession = userSessions.get(socket.id);
      // In a real scenario, you might need to specify which transport
      // For simplicity, using the first transport
      const transport = userSession.transports.get("send");

      if (!transport) {
        throw new Error("Transport not found");
      }

      await transport.connect({ dtlsParameters });
      console.log(`Transport connected successfully for socket: ${socket.id}`);
      if (callback) callback({ status: "ok" });
    } catch (error) {
      console.error("Error connecting transport:", error);
      if (callback) callback({ status: "error", error: error.message });
    }
  });

  socket.on("create-recv-transport", async (callback) => {
    try {
      const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }], // Use your actual IP in production
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        iceLite: false,
        initialAvailableOutgoingBitrate: 1000000,
      });

      const userSession = userSessions.get(socket.id);
      userSession.transports.set("recv", transport);
      const transportParams = {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
      if (callback) callback(transportParams);
    } catch (error) {
      console.error("Error creating recv transport:", error);
      if (callback) callback({ status: "error", error: error.message });
    }
  });
  socket.on("connect-recv-transport", async ({ dtlsParameters }, callback) => {
    try {
      console.log(`Recv Transport connect attempt for socket: ${socket.id}`);
      console.log("Server received dtlsParameters:", dtlsParameters);

      const userSession = userSessions.get(socket.id);
      const transport = userSession.transports.get("recv");

      if (!transport) {
        throw new Error("recv Transport not found");
      }

      await transport.connect({ dtlsParameters });
      console.log(
        `recv Transport connected successfully for socket: ${socket.id}`
      );
      console.log("Current DTLS state:", transport.dtlsState);
      if (callback) callback({ status: "ok" });
    } catch (error) {
      console.error("Error connecting transport:", error);
      if (callback) callback({ status: "error", error: error.message });
    }
  });
  // 1. Send router RTP capabilities
  socket.on("get-rtp-capabilities", () => {
    try {
      socket.emit("rtp-capabilities", router.rtpCapabilities);
    } catch (error) {
      console.error("Error getting RTP capabilities:", error);
    }
  });
  socket.on("get-existing-producers", () => {
    console.log("the current producers length is ", producers.size);
  
    const othersProducers = Array.from(producers.entries())
      .filter(([_, data]) => data.socketId !== socket.id)
      .map(([producerId, data]) => ({
        id: producerId,
        socketId: data.socketId,
        isPaused: data.producer.paused,
        appData: data.appData, // 🔥 REQUIRED
      }));
  
    if (othersProducers.length > 0) {
      socket.emit("existingProducers", {
        producers: othersProducers,
      });
    }
  });
  

  socket.on("producer-paused", ({ producerId }) => {
    const entry = producers.get(producerId);
    if (!entry) {
      console.log("Producer not found:", producerId);
      return;
    }

    const producer = entry.producer;
    const socketId = entry.socketId;
    // Now you can pause it
    producer.pause();
    socket
      .to(roomId)
      .emit("producerpaused", { producerId: producer.id, socketId: socketId });
  });

  socket.on("producer-resume", ({ producerId }) => {
    const entry = producers.get(producerId);
    if (!entry) {
      console.log("Producer not found:", producerId);
      return;
    }

    const producer = entry.producer;
    const socketId = entry.socketId;
    // Now you can pause it
    producer.resume();
    socket
      .to(roomId)
      .emit("producerresume", { producerId: producer.id, socketId: socketId });
  });

  socket.on("consume", async ({ id, rtpCapabilities }, callback) => {
    try {
      console.log("consumer id:", id);

      // Validate inputs
      if (!id || !rtpCapabilities) {
        return callback({ error: "Missing required fields" });
      }

      const info = producers.get(id);

      if (!info) {
        return callback({ error: "Producer not found" });
      }

      const producer = info.producer;
      const userSession = userSessions.get(socket.id);

      if (!producer) {
        console.error("Producer not found for id:", id);
        return callback({ error: `Producer ${id} not found` });
      }

      if (!userSession) {
        console.error("User session not found for socket:", socket.id);
        return callback({ error: "User session not found" });
      }

      const recvTransport = userSession.transports.get("recv");
      if (!recvTransport) {
        console.error("Receive transport not found for user");
        return callback({ error: "Receive transport not found" });
      }

      console.log("Creating consumer for producer:", producer.id);
      const consumer = await recvTransport.consume({
        producerId: producer.id,
        rtpCapabilities: rtpCapabilities,
        appData: producer.appData,
      });

      console.log("Consumer created on server:", consumer.id);
      userSession.consumers.set(consumer.id, consumer);

      callback({
        id: consumer.id,
        producerId: producer.id,
        kind: producer.kind,
        rtpParameters: consumer.rtpParameters,
        appData: producer.appData 
      });
    } catch (error) {
      console.error("Error in consume handler:", error);
      callback({ error: error.message });
    }
  });

  socket.on("consumerResume", async ({ consumerId }) => {
    const userSession = userSessions.get(socket.id);
    const consumer = userSession.consumers.get(consumerId);
    await consumer.resume();
    console.log("consumer resumed for id:", consumerId);
  });

socket.on("get-existing-users", () => {
  // existingUsers is a Map
  const usersArray = Array.from(existingUsers.values())
    .filter(user => user.socketId !== socket.id); // exclude own socket

  // Send existing users to the newly joined socket
  socket.emit("existingUsers", { existingUsers: usersArray });
});

socket.on("screenShareStopped", ({ producerId}) => {
  const session = userSessions.get(socket.id);

  if (!session) {
    console.log(`[screenShareStopped] No session found for socket ${socket.id}`);
    return;
  }

  if (!session.producers) {
    console.log(`[screenShareStopped] No producers map in session for socket ${socket.id}`);
    return;
  }
  console.log("this is the produce id",producerId)
  console.log(`[screenShareStopped] Existing session producers before delete:`, Array.from(session.producers.keys()));
  console.log(`[screenShareStopped] Existing global producers before delete:`, Array.from(producers.keys()));

  const producer = session.producers.get(producerId);

  // Remove from session producers Map
  const deletedFromSession = session.producers.delete(producerId);
  const deletedFromGlobal = producers.delete(producerId);
  const deletedFromProducerToSocket = producerToSocket.delete(producerId);

  console.log(`[screenShareStopped] Deleted from session: ${deletedFromSession}, global: ${deletedFromGlobal}, producerToSocket: ${deletedFromProducerToSocket}`);

  if (producer) {
    try {
      producer.close();
      console.log(`[screenShareStopped] Closed producer ${producerId}`);
    } catch (err) {
      console.error(`[screenShareStopped] Error closing producer ${producerId}:`, err);
    }
  } else {
    console.log(`[screenShareStopped] Producer ${producerId} not found in session`);
  }

  console.log(`[screenShareStopped] Existing session producers after delete:`, Array.from(session.producers.keys()));
  console.log(`[screenShareStopped] Existing global producers after delete:`, Array.from(producers.keys()));

  // Notify all clients in room
  socket.in(roomId).emit("producer-closed", { producerId });
});





  socket.on("leftMeeting", () => {
    const session = userSessions.get(socket.id);
    if (!session) return;
    socket.to(roomId).emit("userDisconnected", { socketId: socket.id });
    console.log("Client disconnected:", socket.id);
    // Remove socket from the room
    socket.leave(roomId);
    // 1. Close consumers
    session.consumers.forEach((consumer) => {
      try {
        consumer.close();
      } catch {}
    });
    session.consumers.clear();

    // 2. Close producers + notify other clients
    session.producers.forEach((producer, producerId) => {
      try {
        producer.close();
      } catch {}

      // Remove from global producers map
      producers.delete(producerId);

      // 🔥 Notify all other sockets that this producer is gone
      socket.to(roomId).emit("producer-closed", { producerId });
    });
    session.producers.clear();

    // 3. Close transports
    session.transports.forEach((transport) => {
      try {
        transport.close();
      } catch {}
    });
    session.transports.clear();

    // 4. Remove session
    userSessions.delete(socket.id);
    existingUsers.delete(socket.id);

    console.log("Cleanup complete. Producers left:", producers.size);
  });
};
