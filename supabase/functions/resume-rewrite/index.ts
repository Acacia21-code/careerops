// v8 — résumé / cover letter / single-bullet writer.
// Routing unchanged from v7: Anthropic key → Claude · else Kimi key → Kimi K3 · else free tier (ai-free).
// v8: hard résumé structure + every match gap must be evidenced OR listed under GAP STATUS (cannot claim).
// v7 compat: optional body.resume_text, mode:'bullet' + body.bullet_text, jobscan_text.
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
  const { jd_text='', mode='resume', jobscan_text='', resume_text='', bullet_text='' } = body
  const gapsRaw = Array.isArray(body.gaps) ? body.gaps
    : Array.isArray(body.missing_keywords) ? body.missing_keywords
    : []
  const gaps = gapsRaw.map((g)=>String(g||'').replace(/^\s*no\s+/i,'').trim()).filter(Boolean).slice(0,12)
  const { data:prof }=await sb.from('mt_profiles').select('ai_key,kimi_key,resume_text,full_name').eq('owner',user.id).maybeSingle()

  const baseResume=(typeof resume_text==='string' && resume_text.trim()) ? resume_text : (prof?.resume_text||'')
  if(mode==='bullet'){
    if(!bullet_text || !bullet_text.trim()) return new Response(JSON.stringify({error:'no bullet provided'}),{headers:cors})
  } else if(!baseResume.trim()){
    return new Response(JSON.stringify({error:'Your master résumé is empty — paste it in Settings first; the AI tailors from it.'}),{headers:cors})
  }

  const sysResume=`You tailor résumés truthfully for ATS and human recruiters.

OUTPUT RULES (non-negotiable):
1) Return ONLY the full résumé text — no preamble, no markdown fences, no commentary.
2) Use these exact section headers, in this order:
PROFESSIONAL SUMMARY
EXPERIENCE
SKILLS
EDUCATION
(optional) CERTIFICATIONS
3) Keep a contact/header line at the top if present in the source.
4) Education, degrees, universities, and certifications NEVER appear as bullets under a job — only under EDUCATION / CERTIFICATIONS.
5) NEVER invent employers, titles, dates, metrics, skills, industries, or tools. Only re-order, re-word, and surface what is already evidenced in the source résumé.
6) SKILLS must be a real bullet list drawn from evidenced experience (prefer JD/ATS keywords only when truthful).
7) Keep it concise and ATS-plain (one page when possible).

MATCH GAPS:
- If MATCH GAPS are listed below, for EACH gap you must either:
  (A) Address it with true facts in Summary, Experience, and/or Skills, OR
  (B) List it under a final section:
GAP STATUS
- <gap>: cannot claim — <one-line honest reason>
- Silent skips are forbidden. Do not fake SaaS/CS/NRR/team-scale experience the source does not support.
- Adjacent transfer language is allowed ONLY when clearly grounded (e.g. partner portfolio ≈ account stewardship) — never as fake titles.

If a Jobscan / guidance block is provided, treat it as priority context under the same honesty rules.`

  const sysCover=`You write truthful, concise cover letters (250–300 words).
STRICT: never invent employers, titles, dates, metrics, or skills.
Use ONLY real experience from the résumé. If MATCH GAPS cannot be claimed, acknowledge the transfer honestly in 1–2 sentences — do not invent CS/SaaS leadership.
Open with why this role, prove fit with 2–3 real points, close with a clear ask. Return only the letter body.`

  const sysBullet=`You rewrite a single resume bullet to better target a specific job description. STRICT RULE: keep every fact — employers, titles, dates, metrics, skills — exactly as given; never invent, add, or inflate anything. Only re-word and re-order what is already in the bullet, surfacing the parts this job description values. One bullet, at most 40 words, no leading bullet character. Return ONLY the rewritten bullet text, nothing else.`

  const sys = mode==='cover' ? sysCover : mode==='bullet' ? sysBullet : sysResume
  const jsBlock = (mode!=='bullet' && jobscan_text && jobscan_text.trim()) ? `\n\nJOBSCAN / EXTRA GUIDANCE (close gaps truthfully):\n${jobscan_text.slice(0,6000)}` : ''
  const gapsBlock = (mode!=='bullet' && gaps.length)
    ? `\n\nMATCH GAPS (each must be evidenced in the résumé OR listed under GAP STATUS):\n${gaps.map((g)=>`- ${g}`).join('\n')}`
    : ''
  const userMsg = mode==='bullet'
    ? `JOB DESCRIPTION:\n${jd_text}\n\nRESUME BULLET TO REWRITE:\n${bullet_text}`
    : `JOB DESCRIPTION:\n${jd_text}${jsBlock}${gapsBlock}\n\nMY RESUME:\n${baseResume}`

  // Provider fetches MUST time out — a hung Claude call previously blocked Kimi fallback
  // until the Supabase gateway returned non-2xx with no useful body.
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

  // thinking disabled on claude-sonnet-5: adaptive thinking is ON by default and CONSUMES max_tokens —
  // it was eating the budget and truncating resumes to just a summary.
  async function viaClaude(key){
    const r=await fetchTimed('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-5',max_tokens:5000,thinking:{type:'disabled'},system:sys,messages:[{role:'user',content:userMsg}]})}, 35000)
    const j=await r.json()
    if(j.error) throw new Error(j.error.message||'claude error')
    const text=(j.content||[]).filter((b)=>b&&b.type==='text'&&typeof b.text==='string').map((b)=>b.text).join('\n').trim()
    if(!text) throw new Error('claude returned no text')
    return { rewritten:text, method:'claude', truncated:j.stop_reason==='max_tokens' }
  }
  async function viaKimi(key){
    // kimi-k3 rejects any temperature other than 1 (400 invalid_request_error).
    const r=await fetchTimed('https://api.moonshot.ai/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:'kimi-k3',max_tokens:5000,temperature:1,messages:[{role:'system',content:sys},{role:'user',content:userMsg}]})}, 110000)
    if(!r.ok) throw new Error('kimi '+r.status+' '+(await r.text()).slice(0,200))
    const j=await r.json()
    const msg=j?.choices?.[0]?.message||{}
    const text=(msg.content||'').trim() || String(msg.reasoning_content||'').trim()
    if(!text) throw new Error('kimi returned no text')
    return { rewritten:text, method:'kimi', truncated:j?.choices?.[0]?.finish_reason==='length' }
  }
  async function viaOpenaiCompat(baseUrl, key, model){
    const base=String(baseUrl||'').replace(/\/+$/,'')
    if(!base || !key) throw new Error('openai-compat missing base/key')
    const r=await fetchTimed(base+'/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify({model:model||'gpt-4o-mini',max_tokens:5000,temperature:0.4,messages:[{role:'system',content:sys},{role:'user',content:userMsg}]})}, 60000)
    if(!r.ok) throw new Error('openai-compat '+r.status+' '+(await r.text()).slice(0,200))
    const j=await r.json()
    const text=(j?.choices?.[0]?.message?.content||'').trim()
    if(!text) throw new Error('openai-compat returned no text')
    return { rewritten:text, method:'openai-compat', truncated:j?.choices?.[0]?.finish_reason==='length' }
  }
  async function viaFree(){
    const r=await fetch(sbUrl+'/functions/v1/ai-free',{method:'POST',headers:{'Authorization':auth,'Content-Type':'application/json'},
      body:JSON.stringify({ system:sys, messages:[{role:'user',content:userMsg}], max_tokens:3000 })})
    const j=await r.json()
    if(j?.error) return { error:j.error }
    if(!j?.text) return { error:'free_unavailable' }
    return { rewritten:j.text, method:'free' }
  }

  const oaiBase=String(body.openai_base_url||'').trim()
  const oaiKey=String(body.openai_key||'').trim()
  const oaiModel=String(body.openai_model||'gpt-4o-mini').trim()||'gpt-4o-mini'
  try{
    const byoTried=[], byoDetails=[]
    // Prefer Kimi when present: Claude (claude-sonnet-5) has hung on full-resume rewrites and
    // previously blocked fallback until the gateway returned a bare non-2xx.
    if(prof?.kimi_key){ try{ return new Response(JSON.stringify(await viaKimi(prof.kimi_key)),{headers:cors}) }catch(e){ byoTried.push('Kimi'); byoDetails.push('Kimi: '+String(e?.message||e).slice(0,180)); console.error('kimi rewrite failed:', String(e?.message||e)) } }
    if(prof?.ai_key){ try{ return new Response(JSON.stringify(await viaClaude(prof.ai_key)),{headers:cors}) }catch(e){ byoTried.push('Claude'); byoDetails.push('Claude: '+String(e?.message||e).slice(0,180)); console.error('claude rewrite failed:', String(e?.message||e)) } }
    if(oaiBase && oaiKey){ try{ return new Response(JSON.stringify(await viaOpenaiCompat(oaiBase, oaiKey, oaiModel)),{headers:cors}) }catch(e){ byoTried.push('OpenAI-compat'); byoDetails.push('OpenAI-compat: '+String(e?.message||e).slice(0,180)); console.error('openai-compat rewrite failed:', String(e?.message||e)) } }
    // If the user has BYO keys, do NOT disguise failure as free-tier outage.
    if(byoTried.length){
      return new Response(JSON.stringify({ error:'byo_failed', tried:byoTried, detail:byoDetails.join(' · ') }),{headers:cors})
    }
    const f=await viaFree()
    if(f.error) return new Response(JSON.stringify({error:f.error}),{headers:cors})
    return new Response(JSON.stringify(f),{headers:cors})
  }catch(e){ console.error('rewrite exception:', String(e)); return new Response(JSON.stringify({error:String(e)}),{headers:cors}) }
})
