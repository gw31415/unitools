import { hc } from "hono/client";
import type { ServerAppType } from "@/server";

export interface UploadResult {
  url: string;
  id: string;
}

/**
 * Upload an image file to the server.
 * @param file - The file to upload
 * @param editorId - The editor ID to associate with the upload
 * @returns The upload result containing the URL and ID
 * @throws Error if upload fails or client is not available
 */
export async function uploadImage(
  file: File,
  editorId: string,
): Promise<UploadResult> {
  if (typeof window === "undefined") {
    throw new Error("Upload client is not available");
  }

  const client = hc<ServerAppType>(window.location.origin);

  const response = await client.api.v1.images.$post({
    form: { file, editorId },
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
      if (text) message = text;
    }

    throw new Error(message);
  }

  return response.json() as Promise<UploadResult>;
}
