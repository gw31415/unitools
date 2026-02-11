import { type ZodType, z } from "zod";
import type { ULID } from "@/lib/ulid";

export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/) as unknown as ZodType<ULID>;
