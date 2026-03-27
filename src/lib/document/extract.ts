import "server-only";

import mammoth from "mammoth";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

let isPdfWorkerConfigured = false;

const ensurePdfWorker = () => {
  if (isPdfWorkerConfigured) {
    return;
  }

  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  );

  PDFParse.setWorker(pathToFileURL(workerPath).href);
  isPdfWorkerConfigured = true;
};

const normalizeText = (text: string) =>
  text
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const collectTextNodes = (value: unknown, acc: string[]) => {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed) {
      acc.push(trimmed);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectTextNodes(entry, acc));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "a:t" || key === "t") {
      collectTextNodes(child, acc);
      continue;
    }

    collectTextNodes(child, acc);
  }
};

const extractPdfText = async (buffer: Buffer) => {
  ensurePdfWorker();

  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();

  return normalizeText(result.text);
};

const extractDocxText = async (buffer: Buffer) => {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value);
};

const extractPptxText = async (buffer: Buffer) => {
  const archive = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const slideText: string[] = [];

  for (const slideName of slideNames) {
    const file = archive.file(slideName);

    if (!file) {
      continue;
    }

    const xml = await file.async("text");
    const parsed = xmlParser.parse(xml);
    const values: string[] = [];
    collectTextNodes(parsed, values);

    if (values.length > 0) {
      slideText.push(values.join(" "));
    }
  }

  return normalizeText(slideText.join("\n\n"));
};

export const extractDocumentText = async (buffer: Buffer, fileName: string) => {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".pdf")) {
    return extractPdfText(buffer);
  }

  if (lowerName.endsWith(".docx")) {
    return extractDocxText(buffer);
  }

  if (lowerName.endsWith(".pptx")) {
    return extractPptxText(buffer);
  }

  throw new Error("Unsupported file type.");
};
