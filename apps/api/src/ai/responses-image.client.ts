import { Injectable } from "@nestjs/common";

export class ImageGenerationTransportError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export interface ResponsesImageRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  toolModel: string;
  imageAction: "generate";
  prompt: string;
  timeoutMs?: number;
}

export interface ResponsesImageResult {
  imageBytes: Buffer;
  seenEvents: string[];
}

@Injectable()
export class ResponsesImageClient {
  async generateImage(input: ResponsesImageRequest): Promise<ResponsesImageResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 600_000);
    try {
      const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.apiKey}`,
          accept: "text/event-stream"
        },
        body: JSON.stringify({
          model: input.model,
          stream: true,
          input: input.prompt,
          tools: [
            {
              type: "image_generation",
              model: input.toolModel,
              action: input.imageAction
            }
          ]
        })
      });

      const body = await response.text();
      if (!response.ok) {
        throw new ImageGenerationTransportError(
          `Responses request failed with HTTP ${response.status}: ${body}`,
          response.status >= 500 || [401, 403, 429].includes(response.status)
        );
      }
      return this.parseEventStream(body);
    } catch (error) {
      if (error instanceof ImageGenerationTransportError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ImageGenerationTransportError(`Network error during image generation: ${message}`, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseEventStream(body: string): ResponsesImageResult {
    let resultBase64: string | undefined;
    let streamError: string | undefined;
    const seenEvents: string[] = [];

    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      const event = this.parseJsonEvent(data);
      if (!event) {
        continue;
      }
      const eventType = typeof event.type === "string" ? event.type : undefined;
      if (eventType) {
        seenEvents.push(eventType);
      }
      if (eventType === "error" || eventType === "response.failed") {
        streamError = this.summarizeStreamError(event);
      }
      const item = this.asRecord(event.item);
      if (item?.type === "image_generation_call" && typeof item.result === "string") {
        resultBase64 = item.result;
      }
      if (
        eventType === "response.output_item.done" &&
        item?.type === "image_generation_call" &&
        typeof item.result === "string"
      ) {
        resultBase64 = item.result;
        break;
      }
    }

    if (!resultBase64) {
      const details = [
        "No image payload found in SSE stream.",
        streamError ? `Upstream error: ${streamError}.` : undefined,
        seenEvents.length > 0 ? `Seen events: ${seenEvents.slice(0, 30).join(", ")}` : undefined
      ].filter(Boolean);
      throw new ImageGenerationTransportError(details.join(" "), true);
    }
    if (!this.isCanonicalBase64(resultBase64)) {
      throw new ImageGenerationTransportError("Image generation result must be canonical base64.", false);
    }
    const imageBytes = Buffer.from(resultBase64, "base64");
    if (!this.isSupportedImage(imageBytes)) {
      throw new ImageGenerationTransportError("Image generation result was not a supported image payload.", false);
    }

    return {
      imageBytes,
      seenEvents
    };
  }

  private isCanonicalBase64(value: string): boolean {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      return false;
    }
    return Buffer.from(value, "base64").toString("base64") === value;
  }

  private isSupportedImage(bytes: Buffer): boolean {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return true;
    }
    if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return true;
    }
    if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") {
      return true;
    }
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }

  private parseJsonEvent(data: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  private summarizeStreamError(event: Record<string, unknown>): string {
    const error = this.asRecord(event.error);
    if (error) {
      const code = typeof error.code === "string" ? error.code : undefined;
      const message = typeof error.message === "string" ? error.message : undefined;
      if (code && message) return `${code}: ${message}`;
      if (code) return code;
      if (message) return message;
    }
    const response = this.asRecord(event.response);
    if (response) {
      const status = typeof response.status === "string" ? response.status : undefined;
      const reason = typeof response.status_details === "string" ? response.status_details : undefined;
      if (status && reason) return `${status}: ${reason}`;
      if (status) return status;
      if (reason) return reason;
    }
    return JSON.stringify(event);
  }
}
