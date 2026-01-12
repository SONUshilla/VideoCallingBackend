import * as mediasoup from 'mediasoup';

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

let worker = null; // singleton worker

// Get or create worker
export const getWorker = async () => {
  if (worker) return worker;

  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    rtcMinPort: 5000,
    rtcMaxPort: 5200
  });

  console.log("Mediasoup worker created");

  worker.on('died', () => {
    console.error('Mediasoup worker died, exiting in 2 seconds...');
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

// Create router (one per room)
export const createRouter = async () => {
  // Ensure worker exists
  const w = await getWorker(); // assign returned worker to a local variable
  const router = await w.createRouter({ mediaCodecs });
  console.log("Mediasoup router created");
  return router;
};
