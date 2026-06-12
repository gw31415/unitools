import { and, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

export interface KVStore<T extends KVStoreVariant> {
  get value(): Promise<KVStoreValue<T>>;
  set value(_: KVStoreValue<T> | Promise<KVStoreValue<T>>);
  fetch(): Promise<void>;
}

export type KVStoreVariant = keyof typeof KVStoreExpiration;

/////////////////////////////////////////////////////////////
// 1/2 ここにKVストアのバリアント名とキャッシュ期間を追加
/////////////////////////////////////////////////////////////

const KVStoreExpiration = {
  FtsVocab: 3600, // 1時間
} as const satisfies Record<string, number | undefined>;

async function getter<V extends KVStoreVariant>(env: CloudflareBindings, variant: V) {
  switch (variant) {
    //////////////////////////////////
    // 2/2 取得ロジックはここに追加
    //////////////////////////////////
    case "FtsVocab":
      const db = drizzle(env.DB, { schema });
      return (
        await db
          .select()
          .from(schema.editorsFtsVocab)
          .where(and(gt(schema.editorsFtsVocab.doc, 0), gt(schema.editorsFtsVocab.cnt, 0)))
          .all()
      ).map(({ term }) => term);
  }
}

async function setter<V extends KVStoreVariant>(
  env: CloudflareBindings,
  variant: V,
  value: KVStoreValue<V>,
) {
  switch (variant) {
    default:
      await env.KV.put(`${KVSTORE_PREFIX}${variant}`, JSON.stringify(value), {
        expiration: KVStoreExpiration[variant],
      });
  }
}

export type KVStoreValue<V extends KVStoreVariant> =
  ReturnType<typeof getter<V>> extends Promise<infer U> ? U : never;

const KVSTORE_PREFIX = "kvstore:";

export function store<V extends KVStoreVariant>(env: CloudflareBindings, variant: V): KVStore<V> {
  const kvKey = `${KVSTORE_PREFIX}${variant}`;
  return {
    async fetch() {
      await getter(env, variant);
    },
    get value() {
      return (async () => {
        const oldValue = await env.KV.get<KVStoreValue<V>>(kvKey);
        if (oldValue) {
          return oldValue;
        }
        const value = getter(env, variant);
        await env.KV.put(kvKey, JSON.stringify(value), {
          expiration: KVStoreExpiration[variant],
        });
        return value;
      })();
    },
    set value(val) {
      void val.then((val) => setter(env, variant, val));
    },
  };
}
