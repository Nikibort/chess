import { google } from "googleapis";
import { readFile } from "fs/promises";
import { parse, addMinutes, addDays, subMinutes, isValid } from "date-fns";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const SRC_ID = process.env.SOURCE_SHEET_ID;
const DST_ID = process.env.DEST_SHEET_ID;

// 48 half-hour labels (B→00:00-00:30, C→00:30-01:00, …)
const SLOT_LABELS = Array.from({ length: 48 }, (_, i) => {
  const start = i * 30;
  const end = (start + 30) % 1440;
  const fmt = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(start)}-${fmt(end)}`;
});

// static row maps for arrivals & departures
const ARR_ROWS = {
  "july 29": 3,
  "july 30": 8,
  "july 31": 13,
  "august 1": 18,
  "august 2": 23,
  "august 3": 28,
  "august 4": 33,
  "august 5": 38,
  "august 6": 43,
  "august 7": 48,
  "august 8": 53,
};
const DEP_ROWS = {
  "august 5": 3,
  "august 6": 8,
  "august 7": 13,
  "august 8": 18,
  "august 9": 23,
  "august 10": 28,
  "august 11": 33,
  "august 12": 38,
};


async function getSheets() {
  const __fn = fileURLToPath(import.meta.url);
  const __dn = path.dirname(__fn);
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(
      await readFile(path.resolve(__dn, "./auth.json"), "utf8")
    ),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth: await auth.getClient() });
}


export async function clearAndRepopulateAll() {
  const sheets = await getSheets();

  // 1) fetch all dest tabs & sheetIds
  const meta = await sheets.spreadsheets.get({ spreadsheetId: DST_ID });
  const tabsMeta = meta.data.sheets.reduce((map, s) => {
    map[s.properties.title] = s.properties.sheetId;
    return map;
  }, {});
  const arrTabs = Object.keys(tabsMeta).filter((t) => /^Arrivals /.test(t));
  const depTabs = Object.keys(tabsMeta).filter((t) => /^Departures /.test(t));

  // 2) clear all passenger-count rows to zero
  const clearReqs = [];
  for (const [map, tabList] of [
    [ARR_ROWS, arrTabs],
    [DEP_ROWS, depTabs],
  ]) {
    for (const tab of tabList) {
      const sheetId = tabsMeta[tab];
      for (const rowNum of Object.values(map)) {
        clearReqs.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: rowNum - 1,
              endRowIndex: rowNum,
              startColumnIndex: 1,
              endColumnIndex: 1 + SLOT_LABELS.length,
            },
            rows: [
              { values: SLOT_LABELS.map(() => ({ userEnteredValue: { numberValue: 0 } })) },
            ],
            fields: "userEnteredValue",
          },
        });
      }
    }
  }
  if (clearReqs.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: DST_ID,
      requestBody: { requests: clearReqs },
    });
    console.log("🧹 Cleared all old passenger counts");
  }

  // 3) prepare in-memory accumulators
  const acc = {};
  arrTabs.forEach(
    (t) => (acc[t] = Array(Object.keys(ARR_ROWS).length).fill(0).map(() => Array(48).fill(0)))
  );
  depTabs.forEach(
    (t) => (acc[t] = Array(Object.keys(DEP_ROWS).length).fill(0).map(() => Array(48).fill(0)))
  );

  // helper: normalize date strings of form d MMMM or dd.MM.yyyy
  function parseDateKey(str, shiftDays = 0) {
    const formats = ["d MMMM", "dd.MM.yyyy"];
    let dt = null;
    for (const fmt of formats) {
      const parsed = parse(str.trim(), fmt, new Date());
      if (isValid(parsed)) {
        dt = parsed;
        break;
      }
    }
    if (!dt) return null;
    const adj = shiftDays ? addDays(dt, shiftDays) : dt;
    return `${adj.toLocaleString("en", { month: "long" }).toLowerCase()} ${adj.getDate()}`;
  }

  // 4) read only "Tracker" tabs from SOURCE
  const srcMeta = await sheets.spreadsheets.get({ spreadsheetId: SRC_ID });
  const trackerTabs = srcMeta.data.sheets
    .map((s) => s.properties.title)
    .filter((t) => t.toLowerCase().includes("tracker"));

  for (const tab of trackerTabs) {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SRC_ID,
      range: `${tab}!A1:S1000`,
    });
    const rows = resp.data.values || [];
    if (rows.length < 2) continue;

    const [headerRow, ...dataRows] = rows;
    const normalizeKey = (str) => str.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const idx = headerRow.reduce((map, h, i) => {
      if (h) map[normalizeKey(h)] = i;
      return map;
    }, {});

    for (const row of dataRows) {
      const arrDate = row[idx["arrivaldate"]];
      const arrTime = row[idx["arrivaltime"]];
      const arrAir = row[idx["arrivalairport"]];
      const depDate = row[idx["departuredate"]];
      const depTime = row[idx["departuretime"]];
      const depAir = row[idx["departureairport"]];

      // — ARRIVALS —
      if (arrAir && arrTime && arrTime !== "0:00:00") {
        const rawArr = parse(arrTime, "H:mm:ss", new Date());
        if (!isNaN(rawArr)) {
          const plus = addMinutes(rawArr, 70);
          const shiftedKey = parseDateKey(
            arrDate,
            plus.getDate() !== rawArr.getDate() ? 1 : 0
          );
          const tabName = arrTabs.find((t) =>
            t.toLowerCase().endsWith(arrAir.toLowerCase())
          );
          if (shiftedKey && ARR_ROWS[shiftedKey] && tabName) {
            const rowIdx = Object.keys(ARR_ROWS).indexOf(shiftedKey);
            const slot = Math.floor((plus.getHours() * 60 + plus.getMinutes()) / 30);
            if (slot >= 0 && slot < 48) acc[tabName][rowIdx][slot]++;
          }
        }
      }

      // — DEPARTURES —
      if (depAir && depTime && depTime !== "0:00:00") {
        const rawDep = parse(depTime, "H:mm:ss", new Date());
        if (!isNaN(rawDep)) {
          const minus = subMinutes(rawDep, 180);
          const shift = minus.getDate() !== rawDep.getDate() ? -1 : 0;
          const key = parseDateKey(depDate, shift);
          const tabName = depTabs.find((t) =>
            t.toLowerCase().endsWith(depAir.toLowerCase())
          );
          if (key && DEP_ROWS[key] && tabName) {
            const rowIdx = Object.keys(DEP_ROWS).indexOf(key);
            const slot = Math.floor((minus.getHours() * 60 + minus.getMinutes()) / 30);
            if (slot >= 0 && slot < 48) acc[tabName][rowIdx][slot]++;
          }
        }
      }
    }
  }

  // 5) write back passenger counts AND highlight non-zero cells
  for (const [tabName, matrix] of Object.entries(acc)) {
    const isArr = arrTabs.includes(tabName);
    const rowMap = isArr ? ARR_ROWS : DEP_ROWS;
    const entries = Object.entries(rowMap);

    // 5a) values update
    const data = entries.map(([_, rowNumber], idx) => ({
      range: `${tabName}!B${rowNumber}:AW${rowNumber}`,
      values: [matrix[idx]],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: DST_ID,
      valueInputOption: "RAW",
      requestBody: { data },
    });

    // 5b) format non-zero cells
    const formatReqs = [];
    entries.forEach(([_, rowNumber], idx) => {
      const rowVals = matrix[idx];
      rowVals.forEach((val, slot) => {
        if (val !== 0) {
          formatReqs.push({
            repeatCell: {
              range: {
                sheetId: tabsMeta[tabName],
                startRowIndex: rowNumber - 1,
                endRowIndex: rowNumber,
                startColumnIndex: 1 + slot,
                endColumnIndex: 2 + slot,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.8, green: 1, blue: 0.8 },
                },
              },
              fields: "userEnteredFormat.backgroundColor",
            },
          });
        }
      });
    });
    if (formatReqs.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: DST_ID,
        requestBody: { requests: formatReqs },
      });
    }
    console.log(`✏️ Wrote & formatted ${tabName}`);
  }

  console.log("✅ Done.");
}

export default clearAndRepopulateAll;
