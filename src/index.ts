import { bot } from "./bot";
import { getModel } from "./agent";
import { startHeartbeat } from "./heartbeat";
import { startScheduler } from "./scheduler";

console.log(`Pi starting...`);
console.log(`Model: ${getModel()}`);
console.log(`Owner: ${process.env.OWNER_ID}`);

bot.start({
  onStart: () => {
    console.log("Pi is running.");
    startHeartbeat();
    startScheduler();
  },
});
