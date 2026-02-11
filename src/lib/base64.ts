import type * as z from "zod";

export const bytesToBase64 = (data: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const b64ToUint8Array = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const structToBase64Url = <T>(data: T): string =>
  btoa(JSON.stringify(data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export const b64urlToStruct = <T extends z.ZodObject>(
  data: string,
  zod: T,
): z.infer<T> => {
  const base64 = data
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(data.length / 4) * 4, "=");
  return zod.parse(JSON.parse(atob(base64)));
};
