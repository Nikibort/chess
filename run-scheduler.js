// run-scheduler.js
import clearAndRepopulateAll from "./server/utils/googleClient.js";

(async () => {
  try {
    await clearAndRepopulateAll();
    process.exit(0);
  } catch (e) {
    console.error("Scheduler run failed:", e);
    process.exit(1);
  }
})();
