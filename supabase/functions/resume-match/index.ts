// Match scorer v4 — recruiter-style fit assessment.
// Routing: Anthropic key → Claude · else Kimi key → Kimi K3 · else free tier (ai-free) · else keyword overlap.
// The keyword score measures vocabulary overlap, NOT fit — it is labeled as such in the UI.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const STOP=new Set(('a an the and or of to in for with on at by as is are be will you your our we they this that role team work working experience years across including etc from into over per within about their them these those who whom which what when where how all any can may must should more most other than then them us it its need needs required requirements responsibilities responsible ability able strong excellent good great new using use used help support build built drive driven lead led manage managed ensure ensuring deliver delivered '+
'please people range learn application applications applicants apply applying compensation benefits salary pay bonus equity collection touch done gets long term nbsp amp opportunity opportunities excellence model models managers manager executives executive month months year location locations remote hybrid onsite role position company companies candidate candidates employment status equal diverse diversity inclusion inclusive disability veteran gender race religion orientation accommodation accommodations privacy policy notice rights reserved qualified without regard national origin employer proud committed offer offers package perks insurance dental vision 401k pto vacation eligible eligibility legally authorized visa sponsorship background check drug free workplace join joining looking seeking ideal love passionate excited mission vision values culture fast paced dynamic environment growth stage things really every each both also well including'+
'').split(/\s+/).filter(Boolean))
const norm=(s)=>s.toLowerCase().replace(/&[a-z]+;|&#\d+;/g,' ').replace(/[^a-z0-9 +#]/g,' ').replace(/\s+/g,' ')
const toks=(s)=>norm(s).split(' ').filter(w=>w.length>2&&!STOP.has(w)&&!/^\d+$/.test(w))
function trimBoilerplate(jd){
  const lower=jd.toLowerCase()
  const markers=['equal employment','equal opportunity','eeo ','e-verify','accommodation','privacy notice','privacy policy','compensation range','pay range','salary range','base salary','base pay','what we offer','benefits include','our benefits','perks','about the company','why join','how to apply','application process','we are committed to','reasonable accommodation']
  let cut=jd.length
  for(const m of markers){ const i=lower.indexOf(m); if(i>jd.length*0.45 && i<cut) cut=i }
  return jd.slice(0,cut)
}
const has=(set,t)=> set.has(t) || set.has(t+'s') || (t.endsWith('s')&&set.has(t.slice(0,-1)))

function keywordScore(resume_text, jd_text){
  const jd=trimBoilerplate(jd_text)
  const resumeSet=new Set(toks(resume_text))
  const resumeNorm=norm(resume_text)
  const freq={}; for(const t of toks(jd)) freq[t]=(freq[t]||0)+1
  const jw=norm(jd).split(' '); const bigrams={}
  for(let i=0;i<jw.length-1;i++){ const a=jw[i],b=jw[i+1]
    if(a.length>2&&b.length>2&&!STOP.has(a)&&!STOP.has(b)&&!/^\d+$/.test(a)&&!/^\d+$/.test(b)){ const g=a+' '+b; bigrams[g]=(bigrams[g]||0)+1 } }
  const keyTerms=Object.entries(freq).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([w])=>w)
  const keyBigrams=Object.entries(bigrams).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([w])=>w)
  const terms = keyTerms.length>=8 ? keyTerms : Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([w])=>w)
  let totalW=0, presentW=0; const present=[], missing=[]
  for(const g of keyBigrams){ totalW+=2
    if(resumeNorm.includes(g) || (g.endsWith('s')&&resumeNorm.includes(g.slice(0,-1)))){ presentW+=2; present.push(g) } else missing.push(g) }
  for(const t of terms){ if(keyBigrams.some(g=>g.includes(t))&&missing.includes(t)) continue
    totalW+=1
    if(has(resumeSet,t)){ presentW+=1; present.push(t) } else missing.push(t) }
  const score= totalW? Math.round(presentW/totalW*100) : 0
  return {match_score:score, method:'keywords', present:present.slice(0,40), missing:missing.slice(0,25)}
}

const PROMPT=(jd,resume)=>`You are a senior recruiter with deep expertise in the candidate's industry. Assess how well this candidate fits this specific job.

Score fit 0-100 the way a great recruiter would:
- 85-100: exceptional — the JD could have been written for them
- 70-84: strong fit — clearly interview-worthy
- 50-69: partial fit — relevant background, real gaps
- below 50: weak fit

Judge substance, not vocabulary: equivalent experience phrased in different words counts fully (e.g. "carrier partnerships" = "air partner relations"). Weigh domain expertise, seniority, scope of ownership, and directly transferable achievements. Ignore boilerplate (EEO, benefits). Do not reward keyword stuffing; do not punish synonyms.

JOB DESCRIPTION:
${jd.slice(0,12000)}

CANDIDATE RÉSUMÉ:
${resume.slice(0,12000)}

Reply with ONLY this JSON, no markdown fences:
{"score": <integer>, "summary": "<2-3 sentences: your honest recruiter read on this fit>", "strengths": ["<up to 6 short phrases: strongest evidence for this role>"], "gaps": ["<up to 6 short phrases: real gaps or evidence missing from the résumé>"]}`

function parseAssessment(text, method){
  const m=String(text||'').match(/\{[\s\S]*\}/)
  if(!m) throw new Error('no JSON in reply')
  const p=JSON.parse(m[0])
  const score=Math.max(0,Math.min(100,Math.round(Number(p.score)||0)))
  return {match_score:score, method, summary:String(p.summary||''), present:(p.strengths||[]).map(String).slice(0,8), missing:(p.gaps||[]).map(String).slice(0,8)}
}

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

async function claudeScore(key, resume_text, jd_text){
  const r=await fetchTimed('https://api.anthropic.com/v1/messages',{
    method:'POST', headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:'claude-sonnet-5',max_tokens:1200,thinking:{type:'disabled'},messages:[{role:'user',content:PROMPT(jd_text,resume_text)}]})
  }, 35000)
  if(!r.ok) throw new Error('claude '+r.status+' '+(await r.text()).slice(0,200))
  const j=await r.json()
  const text=(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')
  return parseAssessment(text,'ai')
}

async function kimiScore(key, resume_text, jd_text){
  const r=await fetchTimed('https://api.moonshot.ai/v1/chat/completions',{
    method:'POST', headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
    // kimi-k3 only allows temperature: 1
    body:JSON.stringify({model:'kimi-k3',max_tokens:1200,temperature:1,response_format:{type:'json_object'},messages:[{role:'user',content:PROMPT(jd_text,resume_text)}]})
  }, 90000)
  if(!r.ok) throw new Error('kimi '+r.status+' '+(await r.text()).slice(0,200))
  const j=await r.json()
  const msg=j?.choices?.[0]?.message||{}
  const text=(msg.content||'').trim() || String(msg.reasoning_content||'').trim()
  return parseAssessment(text,'kimi')
}

async function openaiCompatScore(baseUrl, key, model, resume_text, jd_text){
  const base=String(baseUrl||'').replace(/\/+$/,'')
  if(!base || !key) throw new Error('openai-compat missing base/key')
  const r=await fetchTimed(base+'/chat/completions',{
    method:'POST', headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({model:model||'gpt-4o-mini',max_tokens:1200,temperature:0.3,response_format:{type:'json_object'},messages:[{role:'user',content:PROMPT(jd_text,resume_text)}]})
  }, 60000)
  if(!r.ok) throw new Error('openai-compat '+r.status+' '+(await r.text()).slice(0,200))
  const j=await r.json()
  return parseAssessment(j?.choices?.[0]?.message?.content,'openai-compat')
}

async function freeScore(sbUrl, auth, resume_text, jd_text){
  const r=await fetch(sbUrl+'/functions/v1/ai-free',{
    method:'POST', headers:{'Authorization':auth,'Content-Type':'application/json'},
    body:JSON.stringify({ messages:[{role:'user',content:PROMPT(jd_text,resume_text)}], max_tokens:1200, json:true })
  })
  const j=await r.json()
  if(j?.error) return { error:j.error }
  return parseAssessment(j.text,'free')
}

Deno.serve(async (req)=>{
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'}
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  const body = await req.json().catch(()=>({}))
  const { resume_text='', jd_text='' } = body
  if(!jd_text.trim()) return new Response(JSON.stringify({error:'paste a job description'}),{status:400,headers:cors})
  if(!resume_text.trim()) return new Response(JSON.stringify({error:'add your résumé first (Settings → Profile)'}),{status:400,headers:cors})
  const auth=req.headers.get('Authorization')||''
  const sbUrl=Deno.env.get('SUPABASE_URL')
  try{
    const sb=createClient(sbUrl, Deno.env.get('SUPABASE_ANON_KEY'), { global:{ headers:{ Authorization: auth } } })
    const { data:{ user } }=await sb.auth.getUser()
    let aiKey=null, kimiKey=null
    if(user){ const { data:prof }=await sb.from('mt_profiles').select('ai_key,kimi_key').eq('owner',user.id).maybeSingle(); aiKey=prof?.ai_key||null; kimiKey=prof?.kimi_key||null }
    const oaiBase=String(body.openai_base_url||'').trim()
    const oaiKey=String(body.openai_key||'').trim()
    const oaiModel=String(body.openai_model||'gpt-4o-mini').trim()||'gpt-4o-mini'
    // Prefer Kimi when present (Claude hangs on some full prompts; see resume-rewrite).
    if(kimiKey){
      try{ return new Response(JSON.stringify(await kimiScore(kimiKey, resume_text, jd_text)),{headers:cors}) }
      catch(e){ console.error('kimi score failed:', String(e?.message||e)) }
    }
    if(aiKey){
      try{ return new Response(JSON.stringify(await claudeScore(aiKey, resume_text, jd_text)),{headers:cors}) }
      catch(e){ console.error('claude score failed:', String(e?.message||e)) }
    }
    if(oaiBase && oaiKey){
      try{ return new Response(JSON.stringify(await openaiCompatScore(oaiBase, oaiKey, oaiModel, resume_text, jd_text)),{headers:cors}) }
      catch(e){ console.error('openai-compat score failed:', String(e?.message||e)) }
    }
    if(user){
      try{
        const f=await freeScore(sbUrl, auth, resume_text, jd_text)
        if(!f.error) return new Response(JSON.stringify(f),{headers:cors})
        if(f.error==='free_limit') return new Response(JSON.stringify({error:'free_limit'}),{headers:cors})
        console.error('free score unavailable:', f.error)
      }catch(e){ console.error('free score exception:', String(e?.message||e)) }
    }
    return new Response(JSON.stringify(keywordScore(resume_text, jd_text)),{headers:cors})
  }catch(e){
    return new Response(JSON.stringify(keywordScore(resume_text, jd_text)),{headers:cors})
  }
})
