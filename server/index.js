import express from "express";
import dotenv from "dotenv";
import scheduleRouter from "./routes/schedule.js";

dotenv.config();
console.log("→ DEST_SHEET_ID =", process.env.DEST_SHEET_ID);
console.log("→ SOURCE_SHEET_ID =", process.env.SOURCE_SHEET_ID);

const app = express();
app.use(express.json());

app.use("/schedule", scheduleRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚍 Transport scheduler running on port ${PORT}`);
});
