// Free AI tier — no user API key needed.
// Config from Supabase secrets (FREE_AI_ENDPOINT / FREE_AI_TOKEN / FREE_AI_MODEL) or, if unset,
// from ai_config_v (service-role only). Secrets win.
// Provider must NOT train on request data.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CAP = 30 // AI actions per user per day

async function getConfig(){
  const envBase=(Deno.env.get('FREE_AI_ENDPOINT')||'').replace(/\/+$/,'')
  if(envBase) return { base:envBase, token:Deno.env.get('FREE_AI_TOKEN')||'', model:Deno.env.get('FREE_AI_MODEL')||'google/gemma-4-26B-A4B-it' }
  try{
    const svc=createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
    const { data }=await svc.from('ai_config_v').select('endpoint,token,model').eq('id',1).maybeSingle()
    if(data?.endpoint) return { base:String(data.endpoint).replace(/\/+$/,''), token:data.token||'', model:data.model||'google/gemma-4-26B-A4B-it' }
  }catch(e){ console.error('ai_config read failed:', String(e?.message||e)) }
  return null
}

async function freeComplete(opts:{system?:string, messages:any[], max_tokens?:number, json?:boolean}){
  const cfg=await getConfig()
  if(!cfg) return { error:'free_unavailable' }
  const msgs=[...(opts.system? [{role:'system',content:opts.system}] : []), ...opts.messages]
  try{
    const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(), 90000)
    const r=await fetch(cfg.base+'/chat/completions',{
      method:'POST', signal:ctl.signal,
      headers:{ 'Content-Type':'application/json', ...(cfg.token? {Authorization:'Bearer '+cfg.token} : {}) },
      body:JSON.stringify({ model:cfg.model, messages:msgs, max_tokens:opts.max_tokens??1500, temperature:0.3 })
    })
    clearTimeout(t)
    if(!r.ok){ console.error('free tier http', r.status, (await r.text()).slice(0,300)); return { error:'free_unavailable' } }
    const j=await r.json()
    let text=(j?.choices?.[0]?.message?.content||'').trim()
    text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()
    if(!text) return { error:'free_unavailable' }
    return { text }
  }catch(e){ console.error('free tier exception', String(e)); return { error:'free_unavailable' } }
}

Deno.serve(async (req)=>{
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  const auth=req.headers.get('Authorization')||''
  const sb=createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), { global:{ headers:{ Authorization: auth } } })
  const { data:{ user } }=await sb.auth.getUser()
  if(!user) return new Response(JSON.stringify({error:'not signed in'}),{status:401,headers:cors})
  const body=await req.json().catch(()=>({}))
  // FREE_AI_ALLOW: comma-separated user UUIDs, or "*" for all authenticated users (self-host default).
  const allow=(Deno.env.get('FREE_AI_ALLOW')||'*').trim()
  const allowed = allow==='*' || allow.split(',').map(s=>s.trim()).includes(user.id)
  const today=new Date().toISOString().slice(0,10)

  if(body?.probe==='status'){
    const { data:u }=await sb.from('mt_usage').select('ai_calls').eq('day',today).maybeSingle()
    const cfg=await getConfig()
    return new Response(JSON.stringify({ enabled: !!cfg && allowed, used:u?.ai_calls??0, cap:CAP, remaining:Math.max(0,CAP-(u?.ai_calls??0)) }),{headers:cors})
  }

  if(!allowed) return new Response(JSON.stringify({error:'free_not_enabled'}),{headers:cors})
  const { data:u }=await sb.from('mt_usage').select('ai_calls').eq('day',today).maybeSingle()
  const used=u?.ai_calls??0
  if(used>=CAP) return new Response(JSON.stringify({error:'free_limit'}),{headers:cors})
  if(u) await sb.from('mt_usage').update({ ai_calls: used+1 }).eq('owner',user.id).eq('day',today)
  else await sb.from('mt_usage').insert({ owner:user.id, day:today, searches:0, ai_calls:1 })

  const out=await freeComplete({ system:body.system, messages:body.messages||[], max_tokens:body.max_tokens, json:!!body.json })
  return new Response(JSON.stringify(out),{headers:cors})
})
