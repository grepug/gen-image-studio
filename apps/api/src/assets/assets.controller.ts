import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import { RequestWithHeaders, requireSessionUser } from "../auth/session";
import { AssetsService } from "./assets.service";

interface AssetResponse {
  setHeader(name: string, value: number | string): void;
  status(code: number): AssetResponse;
  end(body: Buffer): void;
}

@Controller("assets")
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get(":assetId/file")
  async getOutputAssetFile(
    @Param("assetId") assetId: string,
    @Req() req: RequestWithHeaders,
    @Res() res: AssetResponse
  ): Promise<void> {
    const user = requireSessionUser(req);
    const file = await this.assets.getOutputImageFile(assetId, user.userId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Length", file.byteSize);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${file.fileName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).end(file.bytes);
  }
}
