import clearAndRepopulateAll from "../server/utils/googleClient.js";

export async function handler(req, res) {
  try {
    await clearAndRepopulateAll();
    res.status(200).send("✅ Scheduler ran successfully.");
  } catch (err) {
    console.error("❌ Scheduler error:", err);
    res.status(500).send("Error: " + err.message);
  }
}
