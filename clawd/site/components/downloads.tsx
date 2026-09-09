'use client';
import {useEffect,useState} from 'react';
import {ArrowDownToLine,ShieldCheck} from 'lucide-react';
type Release={id:string;version:string;platform:string;architecture:string;sha256:string;sizeBytes:number};
const targets=[{platform:"macos",architecture:"arm64",label:"Mac · Apple silicon",chip:"M",description:"For M-series Macs"},{platform:"macos",architecture:"x64",label:"Mac · Intel",chip:"x86",description:"For Intel-based Macs"},{platform:"windows",architecture:"x64",label:"Windows PC",chip:"PC",description:"For 64-bit Windows PCs"},{platform:"linux",architecture:"x64",label:"Linux",chip:"Linux",description:"AppImage and Debian package for x64"}];
export function Downloads(){
  const [releases,setReleases]=useState<Release[]>([]),[state,setState]=useState('Checking release availability…');
  useEffect(()=>{const controller=new AbortController();fetch('/api/releases',{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setReleases(data.releases);setState(data.releases.length?'Verified release files':'Public downloads open after signing and release verification.');}).catch(e=>{if(e.name!=='AbortError')setState('Release availability could not be checked. Please try again later.');});return()=>controller.abort();},[]);
  return <div className="download-grid">{targets.map(target=>{const release=releases.find(r=>r.platform===target.platform&&r.architecture===target.architecture);return <article className="download-card" key={target.platform+target.architecture}>
    <div className="chip-icon">{target.chip}</div><h3>{target.label}</h3><p>{release?`Version ${release.version} · ${(release.sizeBytes/1048576).toFixed(0)} MB`:target.description}</p>
    {release?<><a className="button primary" href={'/api/download/'+release.id}><ArrowDownToLine size={16}/>Download Clawd</a><div className="release-verification"><ShieldCheck size={13}/> {target.platform==='macos'?'Signed & notarized':'Signed release'}</div><details><summary>SHA-256 checksum</summary><code>{release.sha256}</code></details></>:<><button className="button" disabled>Preparing release</button><p className="release-note" role="status">{state}</p></>}
  </article>;})}</div>;
}
