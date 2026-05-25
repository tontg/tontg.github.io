"use strict";

const fileInput = document.querySelector("#file-input");
const fileList = document.querySelector("#file-list");
const clearButton = document.querySelector("#clear-button");
const message = document.querySelector("#message");
const progressLabel = document.querySelector("#progress-label");
const progressBar = document.querySelector("#progress-bar");
const dropZone = document.querySelector("#drop-zone");
const pwaState = document.querySelector("#pwa-state");

let busy = false;

registerServiceWorker();

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files || []);
  renderFiles(files);
  if (files.length > 0) {
    mergeFiles(files);
  }
});

clearButton.addEventListener("click", () => {
  fileInput.value = "";
  renderFiles([]);
  setProgress(0, "Idle");
  setMessage("Waiting for files.");
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  });
}

dropZone.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer.files || []).filter(isSpreadsheetFile);
  if (files.length === 0) {
    setMessage("Select one or more .xls or .xlsx files.", "error");
    return;
  }
  renderFiles(files);
  mergeFiles(files);
});

async function mergeFiles(files) {
  if (busy) {
    return;
  }

  if (!window.ExcelJS || !window.XLSX) {
    setMessage("The Excel libraries did not load. Check the network connection and reload once.", "error");
    return;
  }

  busy = true;
  clearButton.disabled = true;
  fileInput.disabled = true;
  setMessage("Reading first workbook.");
  setProgress(5, "Reading");

  try {
    const validFiles = files.filter(isSpreadsheetFile);
    if (validFiles.length !== files.length) {
      throw new Error("Only .xls and .xlsx files are supported.");
    }

    if (isXlsxFile(validFiles[0])) {
      await mergeWithExcelJsBase(validFiles);
    } else {
      await mergeWithSheetJsBase(validFiles);
    }

    setProgress(100, "Done");
    setMessage("Merged workbook downloaded.", "success");
  } catch (error) {
    console.error(error);
    setProgress(0, "Error");
    setMessage(error.message || "The selected workbooks could not be merged.", "error");
  } finally {
    busy = false;
    clearButton.disabled = files.length === 0;
    fileInput.disabled = false;
  }
}

async function mergeWithExcelJsBase(files) {
  const outputWorkbook = await loadExcelJsWorkbook(files[0]);
  const outputSheet = outputWorkbook.worksheets[0];

  if (!outputSheet) {
    throw new Error(`${files[0].name} does not contain a worksheet.`);
  }

  for (let fileIndex = 1; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    setMessage(`Appending ${file.name}.`);
    setProgress(calculateProgress(fileIndex, files.length, 20, 80), "Appending");

    if (isXlsxFile(file)) {
      const sourceWorkbook = await loadExcelJsWorkbook(file);
      const sourceSheet = sourceWorkbook.worksheets[0];
      if (sourceSheet) {
        appendExcelJsSheetRows(outputSheet, sourceSheet);
      }
    } else {
      appendRowsToExcelJsSheet(outputSheet, await readSheetRows(file, 1));
    }
  }

  setMessage("Creating download.");
  setProgress(90, "Writing");
  downloadBuffer(await outputWorkbook.xlsx.writeBuffer(), buildOutputName());
}

async function mergeWithSheetJsBase(files) {
  const outputWorkbook = await loadSheetJsWorkbook(files[0]);
  const outputSheetName = outputWorkbook.SheetNames[0];

  if (!outputSheetName) {
    throw new Error(`${files[0].name} does not contain a worksheet.`);
  }

  const outputSheet = outputWorkbook.Sheets[outputSheetName];

  for (let fileIndex = 1; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    setMessage(`Appending ${file.name}.`);
    setProgress(calculateProgress(fileIndex, files.length, 20, 80), "Appending");
    appendRowsToSheetJsSheet(outputSheet, await readSheetRows(file, 1));
  }

  setMessage("Creating download.");
  setProgress(90, "Writing");
  downloadBuffer(XLSX.write(outputWorkbook, { bookType: "xlsx", type: "array" }), buildOutputName());
}

function appendExcelJsSheetRows(outputSheet, sourceSheet) {
  let nextRowNumber = outputSheet.rowCount + 1;

  for (let rowNumber = 2; rowNumber <= sourceSheet.rowCount; rowNumber += 1) {
    const sourceRow = sourceSheet.getRow(rowNumber);
    const destinationRow = outputSheet.getRow(nextRowNumber);
    nextRowNumber += 1;

    destinationRow.height = sourceRow.height;
    destinationRow.hidden = sourceRow.hidden;
    destinationRow.outlineLevel = sourceRow.outlineLevel;

    for (let columnNumber = 1; columnNumber <= sourceSheet.columnCount; columnNumber += 1) {
      const sourceCell = sourceRow.getCell(columnNumber);
      const destinationCell = destinationRow.getCell(columnNumber);

      destinationCell.value = clone(sourceCell.value);
      destinationCell.style = clone(sourceCell.style);
      destinationCell.numFmt = sourceCell.numFmt;
      destinationCell.alignment = clone(sourceCell.alignment);
      destinationCell.border = clone(sourceCell.border);
      destinationCell.fill = clone(sourceCell.fill);
      destinationCell.font = clone(sourceCell.font);
      destinationCell.protection = clone(sourceCell.protection);
    }
  }
}

function appendRowsToExcelJsSheet(outputSheet, rows) {
  let nextRowNumber = outputSheet.rowCount + 1;

  for (const row of rows) {
    const destinationRow = outputSheet.getRow(nextRowNumber);
    nextRowNumber += 1;

    row.forEach((value, index) => {
      destinationRow.getCell(index + 1).value = clone(value);
    });
  }
}

function appendRowsToSheetJsSheet(outputSheet, rows) {
  const range = outputSheet["!ref"]
    ? XLSX.utils.decode_range(outputSheet["!ref"])
    : { s: { r: 0, c: 0 }, e: { r: -1, c: 0 } };
  const startRow = range.e.r + 1;
  let maxColumn = range.e.c;

  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      maxColumn = Math.max(maxColumn, columnIndex);
      if (value == null) {
        return;
      }

      outputSheet[XLSX.utils.encode_cell({ r: startRow + rowIndex, c: columnIndex })] = createSheetJsCell(value);
    });
  });

  outputSheet["!ref"] = XLSX.utils.encode_range({
    s: {
      r: range.s.r,
      c: Math.min(range.s.c, 0)
    },
    e: {
      r: Math.max(range.e.r, startRow + rows.length - 1),
      c: Math.max(range.e.c, maxColumn)
    }
  });
}

async function readSheetRows(file, skipRows = 0) {
  const workbook = await loadSheetJsWorkbook(file);
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return [];
  }

  const worksheet = workbook.Sheets[sheetName];
  const range = worksheet["!ref"] ? XLSX.utils.decode_range(worksheet["!ref"]) : null;

  if (!range) {
    return [];
  }

  const rows = [];
  for (let rowNumber = range.s.r + skipRows; rowNumber <= range.e.r; rowNumber += 1) {
    const row = [];
    for (let columnNumber = 0; columnNumber <= range.e.c; columnNumber += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowNumber, c: columnNumber })];
      row.push(cell ? clone(cell.v) : null);
    }
    rows.push(row);
  }

  return rows;
}

async function loadExcelJsWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook;
}

async function loadSheetJsWorkbook(file) {
  return XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true
  });
}

function createSheetJsCell(value) {
  if (value instanceof Date) {
    return { t: "d", v: value };
  }

  switch (typeof value) {
    case "number":
      return { t: "n", v: value };
    case "boolean":
      return { t: "b", v: value };
    default:
      return { t: "s", v: String(value) };
  }
}

function clone(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function renderFiles(files) {
  fileList.replaceChildren();
  clearButton.disabled = files.length === 0 || busy;

  if (files.length === 0) {
    const item = document.createElement("li");
    item.className = "empty-state";
    item.textContent = "No spreadsheets selected";
    fileList.append(item);
    return;
  }

  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = `${file.name} (${formatBytes(file.size)})`;
    fileList.append(item);
  }
}

function isSpreadsheetFile(file) {
  return /\.(xls|xlsx)$/i.test(file.name);
}

function isXlsxFile(file) {
  return /\.xlsx$/i.test(file.name);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function setMessage(text, type = "") {
  message.className = `message ${type}`.trim();
  message.textContent = text;
}

function setProgress(percent, label) {
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressLabel.textContent = label;
}

function calculateProgress(index, total, start, end) {
  if (total <= 1) {
    return end;
  }
  return start + ((end - start) * index) / (total - 1);
}

function buildOutputName() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");

  return `merged-excel-${stamp}.xlsx`;
}

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("sw.js");
    pwaState.textContent = registration.active ? "Offline ready" : "Installing";
  } catch (error) {
    console.warn("Service worker registration failed", error);
    pwaState.textContent = "Web app";
  }
}
