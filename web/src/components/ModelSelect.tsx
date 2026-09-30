// Searchable selection follows the existing 21st.dev combobox interaction.
import { useId, useState, useEffect, useRef } from "react";
import { ChevronDown, RefreshCw, Check } from "lucide-react";
import { useCatalog } from "../catalog";
import type { Provider } from "../types";
export function ModelSelect({provider,value,onChange,name}:{provider?:Provider;value:string;onChange:(v:string)=>void;name:string}) {
 const {catalog,loading,error,refresh}=useCatalog(provider);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[active,setActive]=useState(0);
 const uid=useId(), field=useRef<HTMLDivElement>(null), list=useRef<HTMLUListElement>(null);
 const [above,setAbove]=useState(false);
 useEffect(()=>{if(open&&field.current)setAbove(field.current.getBoundingClientRect().bottom>window.innerHeight-300)},[open]);
 useEffect(()=>{if(open)list.current?.children[active]?.scrollIntoView({block:"nearest"})},[active]);
 const models=(catalog?.models||[]).filter(m=>(m.name+" "+m.id).toLowerCase().includes(query.toLowerCase())).slice(0,60);
 function choose(id:string){onChange(id);setOpen(false);setQuery("")}
 return <div ref={field} className={`model-select ${above?"opens-above":""}`} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}}>
 <label htmlFor={uid}>Model</label>
 <div className="model-select-field">
 <input id={uid} name={name} required maxLength={256} autoComplete="off" spellCheck={false} role="combobox" aria-expanded={open} aria-controls={uid+"-list"} aria-autocomplete="list" aria-activedescendant={open&&models[active]?uid+"-"+active:undefined} placeholder="Search models or enter an ID…" value={open?query:value} onFocus={()=>{setOpen(true);setQuery("");setActive(0)}} onChange={e=>{setQuery(e.target.value);setActive(0);setOpen(true)}} onKeyDown={e=>{if(e.key==="Escape"){setOpen(false);e.preventDefault()}if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setOpen(true);setActive(i=>Math.max(0,Math.min(models.length-1,i+(e.key==="ArrowDown"?1:-1))))}if(e.key==="Enter"&&open){e.preventDefault();if(models[active])choose(models[active].id);else setOpen(false)}}}/>
 <button type="button" tabIndex={-1} aria-label="Show model choices" onClick={()=>{setOpen(!open);setQuery("")}}><ChevronDown size={16} aria-hidden="true"/></button>
 </div>
 {open&&<div className="model-select-popup">
 <div className="model-select-status"><span role="status">{loading?"Loading models…":`${catalog?.models.length||0} saved models`}</span><button type="button" disabled={loading} onClick={()=>void refresh()} aria-label="Refresh provider models"><RefreshCw size={14} aria-hidden="true"/></button></div>
 {error&&<p className="model-select-warning">{catalog?"Refresh failed. Your saved models are available.":"Models unavailable. Refresh or enter a model ID."}</p>}
 <ul ref={list} id={uid+"-list"} role="listbox" aria-label="Provider models">
 {models.map((m,i)=><li id={uid+"-"+i} role="option" aria-selected={m.id===value} className={active===i?"highlighted":""} key={m.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(m.id)} onMouseEnter={()=>setActive(i)}><span><strong>{m.name}</strong><small>{m.id}</small></span>{value===m.id?<Check size={15} aria-hidden="true"/>:m.free?<span className="model-free">Free</span>:null}</li>)}
 {!loading&&!models.length&&<li className="model-select-empty" role="presentation">{query?"No matches. You can use the ID you entered.":"Enter a model ID, or refresh the catalog."}</li>}
 </ul>{query.trim()&&<button className="custom-model-id" type="button" onClick={()=>choose(query.trim())}>Use this model ID: <strong>{query.trim()}</strong></button>}</div>}
 </div>
}
export function ProviderModels({provider}:{provider:Provider}) {
 const {catalog,loading,error,refresh}=useCatalog(provider);
 return <div className="provider-model-status"><span>{loading?"Loading models…":catalog?`${catalog.models.length} models saved`:"Models not loaded"}</span>{error&&<small>{catalog?"Refresh unavailable · saved models ready":"Couldn’t load models"}</small>}<button className="text-button" type="button" disabled={loading} onClick={()=>void refresh()}>{catalog?"Refresh models":"Load models"}<RefreshCw size={13} aria-hidden="true"/></button></div>
}
