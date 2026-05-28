const outputNameInput = document.querySelector("#outputName");
const orientationSelect = document.querySelector("#orientation");
const pageSizeSelect = document.querySelector("#pageSize");
const marginInput = document.querySelector("#margin");
const customSizeBox = document.querySelector("#customSizeBox");
const customWidthInput = document.querySelector("#customWidth");
const customHeightInput = document.querySelector("#customHeight");

const addSlotBtn = document.querySelector("#addSlotBtn");
const bulkAddBtn = document.querySelector("#bulkAddBtn");
const bulkInput = document.querySelector("#bulkInput");
const slotsContainer = document.querySelector("#slots");
const statusEl = document.querySelector("#status");
const generateBtn = document.querySelector("#generateBtn");
const slotTemplate = document.querySelector("#slotTemplate");

const slotState = new Map();
let slotCounter = 0;

function showStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.classList.remove("ok", "warn");
  if (type === "ok") {
    statusEl.classList.add("ok");
  }
  if (type === "warn") {
    statusEl.classList.add("warn");
  }
}

function sanitizeOutputName(rawName) {
  const fallback = "outputname";
  const trimmed = (rawName || "").trim();
  const noExtension = trimmed.replace(/\.pdf$/i, "");
  const cleaned = noExtension.replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_").trim();
  return cleaned || fallback;
}

function getPageFormat() {
  const sizeValue = pageSizeSelect.value;
  if (sizeValue !== "custom") {
    return sizeValue;
  }

  const width = Number(customWidthInput.value);
  const height = Number(customHeightInput.value);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Enter valid positive numbers for custom width and height.");
  }

  return [width, height];
}

function inferImageType(file) {
  const mime = (file?.type || "").toLowerCase();
  if (mime.includes("png")) {
    return "PNG";
  }
  if (mime.includes("webp")) {
    return "WEBP";
  }
  return "JPEG";
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
}

function measureImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight
      });
    };
    img.onerror = () => reject(new Error("Could not load image preview."));
    img.src = dataUrl;
  });
}

function setCustomSizeVisibility() {
  const showCustom = pageSizeSelect.value === "custom";
  customSizeBox.classList.toggle("hidden", !showCustom);
  customSizeBox.setAttribute("aria-hidden", String(!showCustom));
}

function refreshSlotTitles() {
  const cards = [...slotsContainer.querySelectorAll(".slot-card")];
  cards.forEach((card, index) => {
    const title = card.querySelector(".slot-title");
    title.textContent = `Page ${index + 1}`;
  });

  cards.forEach((card) => {
    const removeBtn = card.querySelector(".remove-slot");
    removeBtn.disabled = cards.length === 1;
    removeBtn.title = cards.length === 1 ? "At least one section is required." : "Remove this section";
  });
}

async function attachFileToSlot(slotId, file) {
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    showStatus("Only image files are supported.", "warn");
    return;
  }

  const card = slotsContainer.querySelector(`[data-slot-id="${slotId}"]`);
  if (!card) {
    return;
  }

  const previewBox = card.querySelector(".preview-box");
  const meta = card.querySelector(".slot-meta");

  previewBox.innerHTML = "<span class=\"placeholder\">Loading preview...</span>";

  try {
    const dataUrl = await readFileAsDataURL(file);
    const { width, height } = await measureImage(dataUrl);

    slotState.set(slotId, {
      file,
      dataUrl,
      width,
      height
    });

    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = file.name || "Uploaded image";
    previewBox.innerHTML = "";
    previewBox.appendChild(img);

    meta.textContent = `${file.name} | ${width} x ${height}`;
    showStatus("Image added. Add more or generate the PDF.", "ok");
  } catch (error) {
    slotState.delete(slotId);
    previewBox.innerHTML = "<span class=\"placeholder\">No image selected.</span>";
    meta.textContent = "Accepted formats: JPG, PNG, WEBP, BMP";
    showStatus(error.message, "warn");
  }
}

function setupDropzone(dropzone, input, slotId) {
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-over");
  });

  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
    const [file] = event.dataTransfer?.files || [];
    void attachFileToSlot(slotId, file);
  });

  input.addEventListener("change", () => {
    const [file] = input.files || [];
    void attachFileToSlot(slotId, file);
  });
}

function addSlot(optionalFile) {
  slotCounter += 1;
  const slotId = slotCounter;

  const fragment = slotTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".slot-card");
  const input = fragment.querySelector(".slot-input");
  const removeBtn = fragment.querySelector(".remove-slot");
  const dropzone = fragment.querySelector(".dropzone");

  card.dataset.slotId = String(slotId);

  removeBtn.addEventListener("click", () => {
    const cards = slotsContainer.querySelectorAll(".slot-card");
    if (cards.length === 1) {
      showStatus("At least one upload section must remain.", "warn");
      return;
    }

    slotState.delete(slotId);
    card.remove();
    refreshSlotTitles();
    showStatus("Section removed.");
  });

  setupDropzone(dropzone, input, slotId);

  slotsContainer.appendChild(fragment);
  refreshSlotTitles();

  if (optionalFile) {
    void attachFileToSlot(slotId, optionalFile);
  }
}

function getImagesInOrder() {
  const cards = [...slotsContainer.querySelectorAll(".slot-card")];
  const ordered = cards
    .map((card) => Number(card.dataset.slotId))
    .map((slotId) => slotState.get(slotId))
    .filter(Boolean);

  return ordered;
}

async function generatePdf() {
  const images = getImagesInOrder();
  if (!images.length) {
    showStatus("Upload at least one image before generating a PDF.", "warn");
    return;
  }

  let format;
  try {
    format = getPageFormat();
  } catch (error) {
    showStatus(error.message, "warn");
    return;
  }

  const margin = Number(marginInput.value);
  if (!Number.isFinite(margin) || margin < 0) {
    showStatus("Margin must be 0 or a positive number.", "warn");
    return;
  }

  const orientation = orientationSelect.value;
  const outputName = sanitizeOutputName(outputNameInput.value);

  generateBtn.disabled = true;
  showStatus("Generating PDF...");

  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation,
      unit: "mm",
      format,
      compress: true,
      putOnlyUsedFonts: true
    });

    images.forEach((imageData, index) => {
      if (index > 0) {
        pdf.addPage(format, orientation);
      }

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const maxWidth = Math.max(1, pageWidth - margin * 2);
      const maxHeight = Math.max(1, pageHeight - margin * 2);

      const scale = Math.min(maxWidth / imageData.width, maxHeight / imageData.height);
      const drawWidth = imageData.width * scale;
      const drawHeight = imageData.height * scale;
      const x = (pageWidth - drawWidth) / 2;
      const y = (pageHeight - drawHeight) / 2;

      pdf.addImage(
        imageData.dataUrl,
        inferImageType(imageData.file),
        x,
        y,
        drawWidth,
        drawHeight,
        undefined,
        "FAST"
      );
    });

    pdf.setProperties({
      title: `${outputName}.pdf`,
      creator: "Image to PDF Localhost Website"
    });

    pdf.save(`${outputName}.pdf`);
    showStatus(`Done. Downloaded ${outputName}.pdf`, "ok");
  } catch (error) {
    showStatus(`Failed to generate PDF: ${error.message}`, "warn");
  } finally {
    generateBtn.disabled = false;
  }
}

addSlotBtn.addEventListener("click", () => {
  addSlot();
  showStatus("New image section added.");
});

bulkAddBtn.addEventListener("click", () => {
  bulkInput.click();
});

bulkInput.addEventListener("change", () => {
  const files = [...(bulkInput.files || [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) {
    showStatus("No image files were selected.", "warn");
    return;
  }

  files.forEach((file) => addSlot(file));
  bulkInput.value = "";
});

pageSizeSelect.addEventListener("change", setCustomSizeVisibility);
generateBtn.addEventListener("click", () => {
  void generatePdf();
});

setCustomSizeVisibility();
addSlot();
