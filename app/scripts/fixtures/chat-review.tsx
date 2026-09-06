
import {createRoot} from 'react-dom/client';
import ChatList from '../../src/screens/ChatList';
const base={profile:'builder',preview:'fictional',source:'cli',started_at:0,message_count:1};
let rows=[{...base,id:'new-project',title:'New project chat'},{...base,id:'old-project',title:'Old project chat'},{...base,id:'canonical',title:'Bot Chat'}];
const calls:any[]=[]; const handlers=new Set<any>();
const client:any={url:'https://fixture.invalid',connectionState:'open',
 addStateHandler(fn:any){handlers.add(fn);return ()=>handlers.delete(fn)},
 profilesList:async()=>[{name:'builder',canonical_session:null}],
 sessionFindBotChat:async()=>rows.find(r=>r.id==='canonical') || null,
 projectTree:async()=>({projects:[{id:'project-a',label:'Project A',sessionCount:1,previewSessions:rows.filter(r=>r.id==='new-project')}],scoped_session_ids:['new-project']}),
 projectSessions:async()=>({id:'project-a',label:'Project A',sessionCount:2,repos:[{groups:[{sessions:rows.filter(r=>r.id.endsWith('-project'))}]}]}),
 sessionDelete:async(id:string,profile:string)=>{calls.push({id,profile});rows=rows.filter(r=>r.id!==id);return {deleted:id}},
};
window.fetch=async(input:any)=>{const u=new URL(String(input));if(u.origin!==client.url) throw Error('Denied fixture URL');let value:any;
 if(u.pathname==='/api/profiles/active') value={current:'builder',active:'default'};
 else if(u.pathname==='/api/sessions') value={sessions:rows,total:rows.length,limit:100,offset:0};
 else if(u.pathname.startsWith('/api/sessions/')) {value=rows.find(r=>r.id===decodeURIComponent(u.pathname.split('/').pop()!));if(!value)return new Response('{}',{status:404,headers:{'content-type':'application/json'}});}
 else throw Error('Denied fixture route');
 return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
};
const control={calls,state(state:string){client.connectionState=state;handlers.forEach(fn=>fn(state));},failHydration(){client.projectSessions=async()=>{throw Error('Fixture hydration unavailable');};},switchEndpoint(url:string){client.url=url;render();}};
(window as any).fixture=control;
const root=createRoot(document.getElementById('root')!);
function render(){root.render(<ChatList key={client.url} conn={{id:'fictional-device',url:client.url,label:'Fictional device'} as any} client={client} onOpenChat={()=>{}} onDisconnect={()=>{}}/>);}
render();

