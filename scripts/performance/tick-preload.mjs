import { performance } from "node:perf_hooks";

const interval = globalThis.setInterval;
const periodMs = 50;
const registrations = [];
const samples = [];

globalThis.setInterval = function (callback, delay, ...args) {
  if (delay !== periodMs || typeof callback !== "function") {
    return interval(callback, delay, ...args);
  }
  const appFrame = new Error().stack
    ?.split("\n")[2]
    ?.match(/[\\/]src[\\/]server[\\/](app\.js:\d+:\d+)/);
  if (!appFrame) return interval(callback, delay, ...args);

  const registration = registrations.push(appFrame[1]);
  return interval(
    function (...callbackArgs) {
      const start = performance.now();
      try {
        return callback.apply(this, callbackArgs);
      } finally {
        const durationMs = performance.now() - start;
        samples.push({
          registration,
          startEpochMs: performance.timeOrigin + start,
          durationMs,
        });
      }
    },
    delay,
    ...args,
  );
};

// Collect in memory. IPC and serialization run after the RAF sampling window.
process.on("message", (message) => {
  if (message !== "mistsea-performance-ticks") return;
  process.send?.({ periodMs, registrations, samples });
});
process.channel?.unref();
