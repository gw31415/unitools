import { ulid as base } from "ulid";

export type ULID = string & { readonly __brand: "ulid" };
export const ulid = base as (...args: Parameters<typeof base>) => ULID;
