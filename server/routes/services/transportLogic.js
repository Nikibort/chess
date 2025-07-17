// transportLogic.js
import { updateDemandFromSheets } from "../../utils/googleClient.js";

export async function updateTransportSchedule() {
  console.log("🔄 Fetching and processing flight data from all sheets...");
  await updateDemandFromSheets();
  console.log("✅ Transport schedule update complete.");
}
