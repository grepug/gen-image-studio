import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module";
import { AuthResolver } from "./auth.resolver";
import { AuthService } from "./auth.service";

@Module({
  imports: [DbModule],
  providers: [AuthService, AuthResolver],
  exports: [AuthService]
})
export class AuthModule {}
