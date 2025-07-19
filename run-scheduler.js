#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();

import clearAndRepopulateAll from "./server/utils/googleClient.js";

(async () => {
  try {
    await clearAndRepopulateAll();
    console.log("✅ Scheduler run completed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Scheduler run failed:", err);
    process.exit(1);
  }
})();
