import express from "express";
import clearAndRepopulateAll from "../utils/googleClient.js";

const router = express.Router();
router.post("/update", async (req, res) => {
  try {
    await clearAndRepopulateAll();
    res.status(200).send({ message: "✅ Schedule updated successfully" });
  } catch (err) {
    console.error("❌ Error in update:", err);
    res.status(500).send({ error: "❌ Failed to update schedule" });
  }
});
export default router;
