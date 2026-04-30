import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { DB } from "../db/db.module";
import { assets } from "../db/schema";
import { AppDb } from "../db/types";
import { WorkspacesService } from "../workspaces/workspaces.service";

export interface AssetFile {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  byteSize: number;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly workspaces: WorkspacesService,
    @Inject(DB) private readonly db: AppDb
  ) {}

  async getOutputImageFile(assetId: string, userId: string): Promise<AssetFile> {
    const [asset] = await this.db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    await this.workspaces.assertMember(asset.workspaceId, userId);
    if (asset.kind !== "output-image") {
      throw new ForbiddenException("Asset cannot be served as an output image");
    }
    const filePath = this.resolveAssetPath(asset.storagePath);
    const bytes = await readFile(filePath);
    return {
      bytes,
      fileName: `generated-${asset.sha256.slice(0, 12)}.${this.extensionForMimeType(asset.mimeType)}`,
      mimeType: asset.mimeType,
      byteSize: bytes.length
    };
  }

  private resolveAssetPath(storagePath: string): string {
    const root = resolve(this.assetRoot());
    const filePath = resolve(root, storagePath);
    if (filePath !== root && filePath.startsWith(`${root}${sep}`)) {
      return filePath;
    }
    throw new ForbiddenException("Asset path is outside storage root");
  }

  private assetRoot(): string {
    return process.env.ASSET_STORAGE_DIR ?? ".data/assets";
  }

  private extensionForMimeType(mimeType: string): string {
    if (mimeType === "image/jpeg") return "jpg";
    if (mimeType === "image/gif") return "gif";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/png") return "png";
    return "bin";
  }
}
