import { BadRequestException } from "@nestjs/common";
import { inflateRawSync } from "node:zlib";

export interface ZipEntryMetadata {
  name: string;
  compressionMethod: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface SkillSupportFile {
  path: string;
  content: string;
}

export function readZipEntries(
  bytes: Buffer,
  limits: { maxEntries: number; maxTotalUncompressedBytes: number }
): ZipEntryMetadata[] {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = bytes.readUInt16LE(eocdOffset + 4);
  const centralDirDisk = bytes.readUInt16LE(eocdOffset + 6);
  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDirDisk !== 0) {
    throw new BadRequestException("Skill package must be a single-disk zip archive");
  }
  if (entryCount === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff) {
    throw new BadRequestException("Skill package zip64 archives are not supported");
  }
  if (entryCount <= 0 || entryCount > limits.maxEntries) {
    throw new BadRequestException(`Skill package must contain between 1 and ${limits.maxEntries} entries`);
  }
  if (centralDirOffset + centralDirSize > bytes.length) {
    throw new BadRequestException("Skill package central directory is invalid");
  }

  const entries: ZipEntryMetadata[] = [];
  let offset = centralDirOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new BadRequestException("Skill package central directory is invalid");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nextOffset = nameStart + fileNameLength + extraLength + commentLength;
    if (nextOffset > bytes.length) {
      throw new BadRequestException("Skill package central directory is invalid");
    }
    if ((flags & 0x1) !== 0) {
      throw new BadRequestException("Skill package encrypted entries are not supported");
    }
    if (![0, 8].includes(compressionMethod)) {
      throw new BadRequestException("Skill package entry compression method is not supported");
    }
    const name = normalizeZipPath(bytes.subarray(nameStart, nameStart + fileNameLength).toString("utf8"));
    if (!name) {
      throw new BadRequestException("Skill package entries must have safe relative paths");
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new BadRequestException("Skill package uncompressed content exceeds the 2MB limit");
    }
    if (localHeaderOffset + 30 > bytes.length || localHeaderOffset + compressedSize > bytes.length) {
      throw new BadRequestException("Skill package local file header is invalid");
    }
    entries.push({ name, compressionMethod, flags, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nextOffset;
  }
  return entries;
}

export function readZipEntryBytes(bytes: Buffer, entry: ZipEntryMetadata, maxOutputLength: number): Buffer {
  const offset = entry.localHeaderOffset;
  if (bytes.readUInt32LE(offset) !== 0x04034b50) {
    throw new BadRequestException("Skill package local file header is invalid");
  }
  const fileNameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.length) {
    throw new BadRequestException("Skill package local file data is invalid");
  }
  const compressedBytes = bytes.subarray(dataStart, dataEnd);
  let output: Buffer;
  try {
    output =
      entry.compressionMethod === 0
        ? Buffer.from(compressedBytes)
        : inflateRawSync(compressedBytes, { maxOutputLength });
  } catch {
    throw new BadRequestException("Skill package entry exceeds the allowed extracted size");
  }
  if (output.length !== entry.uncompressedSize) {
    throw new BadRequestException("Skill package entry size metadata does not match content");
  }
  return output;
}

export function assertAllowedSkillMdLocation(path: string): void {
  const parts = path.split("/");
  if (parts.length > 2) {
    throw new BadRequestException("Skill package SKILL.md must be at the root or inside one top-level folder");
  }
}

export function readSkillSupportFiles(
  bytes: Buffer,
  limits: {
    maxEntries: number;
    maxTotalUncompressedBytes: number;
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
  }
): SkillSupportFile[] {
  const entries = readZipEntries(bytes, limits);
  const skillMdEntry = findSingleSkillMdEntry(entries);
  assertAllowedSkillMdLocation(skillMdEntry.name);
  const root = skillPackageRoot(skillMdEntry.name);
  const supportFiles: SkillSupportFile[] = [];
  let totalBytes = 0;

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeSupportPath(entry.name, root);
    if (!relativePath || !isAllowedSupportPath(relativePath) || !isTextLikeSupportFile(relativePath)) {
      continue;
    }
    if (entry.uncompressedSize <= 0 || entry.uncompressedSize > limits.maxFileBytes) {
      continue;
    }
    if (supportFiles.length >= limits.maxFiles || totalBytes + entry.uncompressedSize > limits.maxTotalBytes) {
      break;
    }
    const contentBytes = readZipEntryBytes(bytes, entry, limits.maxFileBytes + 1);
    if (contentBytes.includes(0)) {
      continue;
    }
    const content = contentBytes.toString("utf8");
    if (content.includes("\uFFFD")) {
      continue;
    }
    supportFiles.push({ path: relativePath, content });
    totalBytes += contentBytes.length;
  }

  return supportFiles;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new BadRequestException("Skill package must be a valid zip archive");
}

function findSingleSkillMdEntry(entries: ZipEntryMetadata[]): ZipEntryMetadata {
  const skillMdEntries = entries.filter((entry) => entry.name.endsWith("/SKILL.md") || entry.name === "SKILL.md");
  if (skillMdEntries.length === 0) {
    throw new BadRequestException("Skill package must contain SKILL.md");
  }
  if (skillMdEntries.length > 1) {
    throw new BadRequestException("Skill package must contain exactly one SKILL.md");
  }
  const skillMdEntry = skillMdEntries[0];
  if (!skillMdEntry) {
    throw new BadRequestException("Skill package must contain SKILL.md");
  }
  return skillMdEntry;
}

function normalizeZipPath(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return "";
  }
  return parts.join("/");
}

function skillPackageRoot(skillMdPath: string): string {
  const parts = skillMdPath.split("/");
  return parts.length === 1 ? "" : parts[0] ?? "";
}

function relativeSupportPath(path: string, root: string): string | undefined {
  if (!root) {
    return path;
  }
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
}

function isAllowedSupportPath(path: string): boolean {
  const parts = path.split("/");
  if (parts.length < 2 || parts.some((part) => part === "scripts")) {
    return false;
  }
  return parts[0] === "references" || parts[0] === "assets";
}

function isTextLikeSupportFile(path: string): boolean {
  return /\.(md|markdown|txt|text|json|ya?ml|csv|tsv|prompt)$/i.test(path);
}
