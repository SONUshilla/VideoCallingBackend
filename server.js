import express from 'express';
import { Server } from "socket.io";
import http from 'http';
import * as mediasoup from "mediasoup";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Store user sessions
const userSessions = new Map();
const producers = new Map();   // producerId → producer

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000
    }
  }
];

async function initializeMediaSoup() {
  try {
    const worker = await mediasoup.createWorker({
      rtcMinPort: 40000,
      rtcMaxPort: 49999
    });

    console.log("Mediasoup worker created");

    worker.on('died', () => {
      console.error('Mediasoup worker died, exiting in 2 seconds...');
      setTimeout(() => process.exit(1), 2000);
    });

    const router = await worker.createRouter({ mediaCodecs });
    console.log("Mediasoup router created");

    return { worker, router };
  } catch (error) {
    console.error("Failed to initialize mediasoup:", error);
    throw error;
  }
}

// Initialize mediasoup and start server
initializeMediaSoup().then(({ worker, router }) => {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Initialize user session
    userSessions.set(socket.id, {
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      rtpCapabilities: null
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
      // Step 1: Get all producers except this user's
      console.log("the current producers length is ",producers.size)
      const othersProducers = Array.from(producers.entries())
        .filter(([_, data]) => data.socketId !== socket.id)   // remove own producers
        .map(([producerId]) => producerId);                   // return only ID list
    
      // Step 2: Send only if there are producers from other users
      if (othersProducers.length > 0) {
        socket.emit("existingProducers", {
          producerIds: othersProducers,
        });
      }
    });
    

    // 2. Create WebRTC send transport
    socket.on("create-send-transport", async (callback) => {
      try {
        const transport = await router.createWebRtcTransport({
          listenIps: [{ ip: "0.0.0.0", announcedIp: "videocallingfrontend-5s8t.onrender.com" }], // Use your actual IP in production
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          initialAvailableOutgoingBitrate: 1000000
        });

        const userSession = userSessions.get(socket.id);
        userSession.transports.set("send", transport);

        // Handle produce event from client
        socket.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
          try {
            console.log(`Produce event - kind: ${kind}, socket: ${socket.id}`);
            
            const producer = await transport.produce({ 
              kind, 
              rtpParameters 
            });

            userSession.producers.set(producer.id, producer);
            console.log(`Producer created - id: ${producer.id}, kind: ${kind}`);
            producers.set(producer.id, { producer, socketId: socket.id });
            producers.set(producer.id, { producer, socketId: socket.id });
            
            socket.broadcast.emit("newProducer", {
              clientId:socket.id,
              producerId: producer.id
            });
            
            producer.on("transportclose", () => {
              console.log(`Producer transport closed - id: ${producer.id}`);
              producer.close();
              userSession.producers.delete(producer.id);
            });


            callback({ id: producer.id });
          } catch (error) {
            console.error("Error in produce:", error);
            errback(error);
          }
        });

        const transportParams = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        };

        socket.emit("send-transport-created", transportParams);
        if (callback) callback({ status: "ok", transport: transportParams });

      } catch (error) {
        console.error("Error creating send transport:", error);
        if (callback) callback({ status: "error", error: error.message });
      }
    });

    // 3. Connect transport DTLS
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
          listenIps: [{ ip: "0.0.0.0", announcedIp: "videocallingfrontend-5s8t.onrender.com" }], // Use your actual IP in production
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
          initialAvailableOutgoingBitrate: 1000000
        });

        const userSession = userSessions.get(socket.id);
        userSession.transports.set("recv", transport);
        const transportParams = {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
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
        
        const userSession = userSessions.get(socket.id);
        const transport = userSession.transports.get("recv");
        
        if (!transport) {
          throw new Error("recv Transport not found");
        }

        await transport.connect({ dtlsParameters });
        console.log(`recv Transport connected successfully for socket: ${socket.id}`);
        if (callback) callback({ status: "ok" });
      } catch (error) {
        console.error("Error connecting transport:", error);
        if (callback) callback({ status: "error", error: error.message });
      }
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
        });

        console.log("Consumer created on server:", consumer.id);
        userSession.consumers.set(consumer.id, consumer);

        callback({
          id: consumer.id,
          producerId: producer.id,
          kind: producer.kind,
          rtpParameters: consumer.rtpParameters,
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
      console.log("consumer resumed for id:",consumerId)
    });

    socket.on("disconnect", () => {
      const session = userSessions.get(socket.id);
      if (!session) return;
    
      console.log("Client disconnected:", socket.id);
    
      // 1. Close consumers
      session.consumers.forEach((consumer) => {
        try { consumer.close(); } catch {}
      });
      session.consumers.clear();
    
      // 2. Close producers + notify other clients
      session.producers.forEach((producer, producerId) => {
        try { producer.close(); } catch {}
    
        // Remove from global producers map
        producers.delete(producerId);
    
        // 🔥 Notify all other sockets that this producer is gone
        socket.broadcast.emit("producer-closed", { producerId });
      });
      session.producers.clear();
    
      // 3. Close transports
      session.transports.forEach((transport) => {
        try { transport.close(); } catch {}
      });
      session.transports.clear();
    
      // 4. Remove session
      userSessions.delete(socket.id);
    
      console.log("Cleanup complete. Producers left:", producers.size);
    });
    
    
    
    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  server.listen(5000, () => {
    console.log("Server running on port 5000");
  });
}).catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});