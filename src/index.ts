import { bot } from "./bot";
import { getModel } from "./agent";

console.log(`PlanetAgent starting...`);
console.log(`Model: ${getModel()}`);
console.log(`Owner: ${process.env.OWNER_ID}`);

bot.start({
  onStart: () => {
    console.log("PlanetAgent is running.");
  },
});
