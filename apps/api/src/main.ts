import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

const uploadBodyLimit = "1mb";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: uploadBodyLimit });
  app.useBodyParser("urlencoded", { extended: true, limit: uploadBodyLimit });
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  app.enableCors({
    origin: webOrigin,
    credentials: true
  });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/graphql`, "Bootstrap");
}

void bootstrap();
