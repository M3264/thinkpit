import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Catalog, Provider } from "./types";

type Entry = { catalog?: Catalog; loading: boolean; error: string };
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();
let generation = 0;
const listeners = new Set<() => void>();
const empty: Entry = { loading: false, error: "" };
const keyOf = (p: Provider) => JSON.stringify([p.id,p.base_url,p.kind,p.has_key,p.endpoint_path]);
const emit = () => listeners.forEach(fn => fn());
export function clearCatalogs() { generation++; entries.clear(); pending.clear(); emit(); }
export function peekCatalog(p: Provider): Entry { return entries.get(keyOf(p)) || empty; }
export function loadCatalog(p: Provider, refresh = false, publicCatalog = false): Promise<void> {
 const key = keyOf(p);
 if (pending.has(key)) return pending.get(key)!;
 const version = generation;
 const prior = entries.get(key);
 if (!refresh && prior?.catalog && !prior.error) return Promise.resolve();
 entries.set(key,{...prior,loading:true,error:""});emit();
 const path = publicCatalog ? "/catalog/openrouter" : `/providers/${encodeURIComponent(p.id)}/models`;
 const promise = api<Catalog>(path + (refresh ? "?refresh=true" : ""))
 .then(catalog => { if(version!==generation)return;entries.set(key,{catalog,loading:false,error:catalog.warning || ""}); })
 .catch(e => { if(version!==generation)return;entries.set(key,{catalog:prior?.catalog,loading:false,error:e.message}); })
 .finally(() => {if(version===generation){pending.delete(key);emit();}});
 pending.set(key,promise);return promise;
}
export function useCatalog(p?: Provider, publicCatalog = false) {
 const key=p?keyOf(p):"";
 const entry=useSyncExternalStore(cb=>{listeners.add(cb);return()=>{listeners.delete(cb)}},()=>entries.get(key)||empty);
 useEffect(()=>{if(p)void loadCatalog(p,false,publicCatalog)},[key,publicCatalog]);
 return {...entry,refresh:()=>p?loadCatalog(p,true,publicCatalog):Promise.resolve()};
}
