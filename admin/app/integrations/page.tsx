'use client';
import {useState,useEffect} from 'react';
import Sidebar from '@/components/Sidebar';
import {apiGet} from '@/lib/api';
export default function Integrations() {
 const [data,setData]=useState<Record<string,unknown>|null>(null),[error,setError]=useState('');
 const load=()=>{setError('');apiGet<Record<string,unknown>>('/api/admin/integration-status').then(setData).catch(e=>setError(e.message));};
 useEffect(load,[]);
 return <div className="flex"><Sidebar/><main className="flex-1 p-8"><h1 className="text-2xl font-bold">Authentication & Integration Health</h1><button className="btn-primary my-4" onClick={load}>Refresh status</button>{error&&<p role="alert">{error}</p>}{data?Object.entries(data).map(([name,value])=><section className="card mb-4" key={name}><h2 className="font-bold">{name}</h2><pre className="whitespace-pre-wrap text-sm">{JSON.stringify(value,null,2)}</pre></section>):!error&&<p>Loading…</p>}<p>Configured means environment present, not a successful live provider test. Credentials are never returned.</p></main></div>;
}
