import { hc } from "hono/client";
import type { ServerAppType } from "@/server";

interface UploadImageOptions {
  file: File;
  editorId: string;
}

const client =
  typeof window === "undefined"
    ? null
    : hc<ServerAppType>(window.location.origin);

export async function uploadImage(options: UploadImageOptions): Promise<{
  url: string;
  id: string;
}> {
  const { file, editorId } = options;

  if (!client) {
    throw new Error("Upload client is not available");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed");
  }

  const response = await client.api.v1.images.$post({
    form: {
      file,
      editorId,
    },
  });

  if (!response.ok) {
    let message = "Failed to upload image";
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const error = await response.json();
      if ("error" in error && typeof error.error === "string") {
        message = error.error;
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }

    throw new Error(message);
  }

  return (await response.json()) as { url: string; id: string };
}
