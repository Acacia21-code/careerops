// Board-aware assistant.
// Routing: Anthropic key → Claude · else Kimi key → Kimi K3 · else free tier (ai-free).
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req)=>{
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  const auth=req.headers.get('Authorization')||''
  const sbUrl=Deno.env.get('SUPABASE_URL')
  const sb=createClient(sbUrl,Deno.env.get('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:auth}}})
  const { data:{ user } }=await sb.auth.getUser()
  if(!user) return new Response(JSON.stringify({error:'not signed in'}),{status:401,headers:cors})
  const body = await req.json().catch(()=>({}))
  const { messages=[] } = body
  const { data:prof }=await sb.from('mt_profiles').select('ai_key,kimi_key,resume_text,full_name').eq('owner',user.id).maybeSingle()
  const oaiBase=String(body.openai_base_url||'').trim()
  const oaiKey=String(body.openai_key||'').trim()
  const oaiModel=String(body.openai_model||'gpt-4o-mini').trim()||'gpt-4o-mini'

  const DAY=864e5, now=Date.now(), today=new Date().toISOString().slice(0,10)
  let ctx=''
  try{
    const { data: shared } = await sb.from('mt_roles').select('id,company,title,stage,fit_score,match_score,created_at').limit(300)
    const { data: reps } = await sb.from('mt_reports').select('role_id,kind')
    const hasDoc=new Set((reps||[]).filter(x=>x.kind==='resume'||x.kind==='cover').map(x=>x.role_id))
    const act=(shared||[]).filter(r=>r.stage!=='closed'&&r.stage!=='rejected')
    const byStage={}; for(const r of (shared||[])) (byStage[r.stage]=byStage[r.stage]||[]).push(r)
    const counts=Object.entries(byStage).map(([s,a])=>s+': '+a.length).join(', ')
    const fu=((byStage['applied']||[]).concat(byStage['interview']||[])).map(r=>{
      const due=new Date(new Date(r.created_at||now).getTime()+14*DAY).toISOString().slice(0,10)
      return `- ${r.company} — ${r.title} (follow up by ${due})`}).join('\n')
    const lines=act.slice(0,30).map(r=>`- ${r.company} — ${r.title} (${r.stage}${r.match_score?', match '+r.match_score:''}${hasDoc.has(r.id)?', has tailored docs':''}`+')').join('\n')
    ctx=`DASHBOARD: CareerOps (careerops.telivity.app) — the user's private job-search app. You are its built-in assistant.

HOW THE APP WORKS — teach this accurately when asked:
• Board stages: Sourced → Researched → Conversation → Applied → Interview → Offer → Rejected → Closed. Drag cards between columns; Rejected = they said no, Closed = user dropped it.
• "Run job search" (header) scans configured company career boards (Greenhouse / Ashby / Lever-style public ATS JSON) filtered by the user's saved titles/keywords/seniority/locations (editable in Settings). Capped at 10 searches/day.
• "Add role" (header) adds any job found elsewhere — company, title, link — and the JD auto-loads.
• THE KEY WORKFLOW — CLICK ANY ROLE CARD: a panel opens where the job description auto-loads from the posting (and is saved to the card; pasted JDs autosave too). From there: (1) Get match report — recruiter-style fit score + gaps, saved onto the card; (2) Tailor résumé or Cover letter — written for that exact job, downloadable as Word; (3) upload a Jobscan report PDF — its findings feed the next Tailor run; (4) Apply — Open JD opens the real posting.
• AI tiers: the app includes FREE AI (no key, 30 uses/day). Adding your own Anthropic (Claude) or Kimi K3 key in Settings gives higher quality and no daily limit.
• FOLLOW-UPS box above the board: roles in Applied/Interview get a follow-up due 14 days after landing there; overdue = red.
• Settings: profile, master résumé (ground truth for AI tools), search preferences, API keys, optional AI-Text-Humanizer login, data export (JSON/CSV).
• Support CareerOps (header) = optional donations; the product is free forever.

LIVE BOARD (as of ${today}):
Stage counts: ${counts||'empty'}

FOLLOW-UPS:
${fu||'(none yet — nothing in Applied/Interview)'}

ACTIVE ROLES (first 30):
${lines||'(no roles yet — suggest hitting Run job search)'}`
  }catch(_e){ ctx='(pipeline snapshot unavailable this turn)' }

  const sys=`You are the built-in assistant of the user's job-search dashboard. You KNOW the app and the live pipeline below — use them; never say you can't see their board, and when explaining features describe the app EXACTLY as documented below (especially: click a role card for the JD/match/tailor/apply panel — that is the main workflow). You cannot click, drag, or edit the board yourself — when action is needed, give the exact draft or step the user should take.

Help with: follow-up messages, résumé bullets, cover letters, LinkedIn outreach, interview prep, comp negotiation, and search strategy. Be concise, specific, practical — no fluff. NEVER fabricate the user's experience, employers, titles, dates, or metrics — the résumé below is ground truth.

=== ${ctx} ===

USER RÉSUMÉ:
${prof?.resume_text||'(not provided)'}`

  const clean=(Array.isArray(messages)?messages:[]).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string'&&m.content.trim()).slice(-20)
  if(!clean.length) return new Response(JSON.stringify({error:'no message'}),{headers:cors})

  async function fetchTimed(url, init, ms){
    const ctrl=new AbortController()
    const t=setTimeout(()=>ctrl.abort(), ms)
    try{
      return await fetch(url,{...init, signal:ctrl.signal})
    }catch(e){
      if(ctrl.signal.aborted) throw new Error('timeout after '+ms+'ms')
      throw e
    }finally{ clearTimeout(t) }
  }
  async function viaClaude(key){
    const r=await fetchTimed('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-5',max_tokens:6000,thinking:{type:'disabled'},system:sys,messages:clean})}, 35000)
    const j=await r.json()
    if(j.error) throw new Error(j.error.message||'claude error')
    const reply=(j.content||[]).filter((b)=>b&&b.type==='text'&&typeof b.text==='string').map((b)=>b.text).join('\n').trim()
    if(!reply) throw new Error('claude returned no text')
    return { reply, method:'claude' }
  }
  async function viaKimi(key){
    const r=await fetchTimed('https://api.moonshot.ai/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:'kimi-k3',max_tokens:4000,temperature:1,messages:[{role:'system',content:sys},...clean]})}, 90000)
    if(!r.ok) throw new Error('kimi '+r.status+' '+(await r.text()).slice(0,200))
    const j=await r.json()
    const msg=j?.choices?.[0]?.message||{}
    const reply=(msg.content||'').trim() || String(msg.reasoning_content||'').trim()
    if(!reply) throw new Error('kimi returned no text')
    return { reply, method:'kimi' }
  }
  async function viaOpenaiCompat(baseUrl, key, model){
    const base=String(baseUrl||'').replace(/\/+$/,'')
    if(!base || !key) throw new Error('openai-compat missing base/key')
    const r=await fetchTimed(base+'/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:model||'gpt-4o-mini',max_tokens:4000,temperature:0.4,messages:[{role:'system',content:sys},...clean]})}, 60000)
    if(!r.ok) throw new Error('openai-compat '+r.status+' '+(await r.text()).slice(0,200))
    const j=await r.json()
    const reply=(j?.choices?.[0]?.message?.content||'').trim()
    if(!reply) throw new Error('openai-compat returned no text')
    return { reply, method:'openai-compat' }
  }
  async function viaFree(){
    const r=await fetch(sbUrl+'/functions/v1/ai-free',{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/json'},
      body:JSON.stringify({ system:sys, messages:clean, max_tokens:1500 })})
    const j=await r.json()
    if(j?.error) return { error:j.error }
    if(!j?.text) return { error:'free_unavailable' }
    return { reply:j.text, method:'free' }
  }

  try{
    const byoTried=[], byoDetails=[]
    if(prof?.kimi_key){ try{ return new Response(JSON.stringify(await viaKimi(prof.kimi_key)),{headers:cors}) }catch(e){ byoTried.push('Kimi'); byoDetails.push('Kimi: '+String(e?.message||e).slice(0,180)); console.error('kimi chat failed:', String(e?.message||e)) } }
    if(prof?.ai_key){ try{ return new Response(JSON.stringify(await viaClaude(prof.ai_key)),{headers:cors}) }catch(e){ byoTried.push('Claude'); byoDetails.push('Claude: '+String(e?.message||e).slice(0,180)); console.error('claude chat failed:', String(e?.message||e)) } }
    if(oaiBase && oaiKey){ try{ return new Response(JSON.stringify(await viaOpenaiCompat(oaiBase, oaiKey, oaiModel)),{headers:cors}) }catch(e){ byoTried.push('OpenAI-compat'); byoDetails.push('OpenAI-compat: '+String(e?.message||e).slice(0,180)); console.error('openai-compat chat failed:', String(e?.message||e)) } }
    if(byoTried.length){
      return new Response(JSON.stringify({ error:'byo_failed', tried:byoTried, detail:byoDetails.join(' · ') }),{headers:cors})
    }
    const f=await viaFree()
    if(f.error) return new Response(JSON.stringify({error:f.error}),{headers:cors})
    return new Response(JSON.stringify(f),{headers:cors})
  }catch(e){ console.error('chat exception:', String(e)); return new Response(JSON.stringify({error:String(e)}),{headers:cors}) }
})
