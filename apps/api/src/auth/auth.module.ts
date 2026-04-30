import { Module } from "@nestjs/common";
import { AuthResolver } from "./auth.resolver";
import { AuthService } from "./auth.service";

@Module({
  providers: [AuthService, AuthResolver],
  exports: [AuthService]
})
export class AuthModule {}

