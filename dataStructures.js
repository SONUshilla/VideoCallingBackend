// dataStructures.js
export const userSessions = new Map();
export const producerToSocket = new Map();
export const producers = new Map();

// roomData.js
export const rooms = new Map(); // roomId => { router, producers, audioLevelObserver, userSessions }


  // Helper so you never repeat this
export const getContext = (roomId) => {
    const room = rooms.get(roomId);
    if (!room) throw new Error("Room not initialized yet");

    return {
      room,
      router: room.router,
      userSessions:room.userSessions,
      producers: room.producers,
      audioLevelObserver:room.audioLevelObserver,
      existingUsers:room.existingUsers
    };
  };


export const socketToRoom = new Map();
