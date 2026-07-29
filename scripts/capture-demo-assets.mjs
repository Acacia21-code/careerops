import { chromium } from 'playwright'
import sharp from 'sharp'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'docs', 'assets')
const frames = path.join(out, '.capture-frames')
await mkdir(frames, { recursive: true })

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.route('**/*.supabase.co/**', route => route.abort())
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' })
await page.addStyleTag({ content: `
  html,body{width:100%;height:100%;overflow:hidden}
  .demo-seed{position:fixed;right:18px;bottom:16px;z-index:99999;background:#102a43;color:#fff;
    border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:7px 12px;font:700 11px/1.2 system-ui;
    letter-spacing:.08em;box-shadow:0 6px 22px rgba(0,0,0,.2)}
  .demo-caption{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99998;
    background:rgba(255,255,255,.96);color:#102a43;border:1px solid #cbd5e1;border-radius:999px;
    padding:9px 18px;font:650 14px/1.2 system-ui;box-shadow:0 6px 22px rgba(0,0,0,.16)}
  .demo-card{min-height:104px}.demo-card .co{color:#0a8577}.demo-card .role{margin-top:5px}
  .demo-surface{background:#fff;border:1px solid var(--hair);border-radius:14px;padding:14px;box-shadow:var(--shadow)}
  .demo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
  .demo-kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);font-weight:700}
  .demo-draft{white-space:pre-wrap;font:13px/1.58 ui-monospace,SFMono-Regular,Menlo,monospace}
  .not-me,.col-add{display:none!important}
` })

const render = async (scene, step, caption) => {
  await page.evaluate(({ scene, step, caption }) => {
    const $ = id => document.getElementById(id)
    document.querySelectorAll('.modal').forEach(el => el.classList.add('hidden'))
    ;['auth','onboard','app','builderView'].forEach(id => $(id)?.classList.add('hidden'))
    document.querySelector('.demo-seed')?.remove()
    document.querySelector('.demo-caption')?.remove()
    const badge = document.createElement('div')
    badge.className = 'demo-seed'
    badge.textContent = 'SEEDED DEMO · FICTIONAL DATA'
    document.body.appendChild(badge)
    if (caption) {
      const cap = document.createElement('div')
      cap.className = 'demo-caption'
      cap.textContent = caption
      document.body.appendChild(cap)
    }

    const activate = section => {
      $('app').classList.remove('hidden')
      $('stage').classList.toggle('hidden', section !== 'board')
      ;['memorySection','portfolioSection','advisorSection'].forEach(id => $(id)?.classList.add('hidden'))
      if (section !== 'board') $(`${section}Section`)?.classList.remove('hidden')
      document.querySelectorAll('#hdr_tabs .hdr-tab').forEach(tab => {
        const on = tab.dataset.section === section
        tab.classList.toggle('active', on)
        tab.setAttribute('aria-selected', on ? 'true' : 'false')
      })
      $('hdr_board_actions')?.classList.toggle('hidden', section !== 'board')
      $('setupbanner')?.classList.add('hidden')
      $('cadence_nudge')?.classList.add('hidden')
      $('followups')?.classList.add('hidden')
      $('triage')?.classList.add('hidden')
      $('reconcile_banner')?.classList.add('hidden')
      if ($('hello')) $('hello').textContent = '· Demo Candidate'
    }
    const card = (company, role, score, extra='') => `<div class="cardlet demo-card">
      <div class="co">${company}</div><div class="role">${role}</div>
      <div class="meta">${score ? `<span class="match-pill">${score}% match</span>` : '<span class="match-pill none">Not scored</span>'}${extra}</div>
      <a class="jd" href="#">Open JD ↗</a></div>`
    const col = (name, count, body) => `<div class="col"><h3>${name}<span>${count}</span></h3>${body || '<div class="muted" style="font-size:11px;padding:6px">—</div>'}</div>`
    const board = stage => {
      const roles = {
        sourced: card('Northstar Labs','Senior Product Engineer',82,'<span class="age-pill">Remote</span>'),
        researched: card('Juniper Works','Platform Engineer',76,'<span class="verdict apply">Apply</span>'),
        applied: card('Bluebird Systems','Staff Software Engineer',88,'<span class="doc">✓ sent</span>'),
        interview: card('Cedar Studio','Engineering Lead',84,'<span class="doc">prep</span>'),
        offer: card('Orbit & Pine','Principal Engineer',91,'<span class="doc">offer</span>'),
      }
      const moving = card('Northstar Labs','Senior Product Engineer',82,'<span class="age-pill">Remote</span>')
      if (stage > 0) roles.sourced = ''
      if (stage === 1) roles.researched = moving
      if (stage === 2) roles.applied = moving
      if (stage >= 3) roles.interview = moving
      $('board').innerHTML = [
        col('Sourced', roles.sourced ? 1 : 0, roles.sourced),
        col('Researched', roles.researched ? 1 : 0, roles.researched),
        col('Conversation',0,''),
        col('Applied', roles.applied ? 1 : 0, roles.applied),
        col('Interview', roles.interview ? 1 : 0, roles.interview),
        col('Offer',1,roles.offer),
        col('Rejected',0,''),
      ].join('')
      if ($('status')) $('status').innerHTML = '<b>5 active roles</b> · Everything shown is seeded demo data'
    }

    if (scene === 'board') {
      activate('board')
      board(step)
    }

    if (scene === 'memory') {
      activate('memory')
      $('memorySection').classList.remove('hidden')
      $('mem_body').value = step >= 1 ? 'Reduced release rollback time by standardizing service health checks and runbooks.' : ''
      $('mem_employer').value = step >= 1 ? 'Northstar Labs' : ''
      $('mem_project').value = step >= 1 ? 'Release reliability' : ''
      $('mem_role').innerHTML = '<option>Senior Product Engineer · Northstar Labs</option>'
      const promoted = step >= 4
      $('mem_list').innerHTML = step < 2 ? '<p class="muted" style="font-size:13px">Capture a true accomplishment while it is fresh.</p>' : `
        <div class="card" style="padding:14px;margin:8px 0">
          <div style="display:flex;gap:10px"><input type="checkbox" checked style="width:auto">
          <div style="flex:1"><div style="font-size:14px;line-height:1.5">Reduced release rollback time by standardizing service health checks and runbooks.</div>
          <div class="muted" style="font-size:11.5px;margin-top:6px">${promoted ? 'promoted · ' : 'accepted · '}Northstar Labs · Release reliability ${promoted ? '<span class="chip">promoted</span>' : ''}</div>
          <div class="row" style="margin-top:9px"><button class="btn sm">Edit</button><button class="btn sm">Polish</button>
          <button class="btn sm primary">${promoted ? 'Promoted ✓' : step === 3 ? 'Promote to selected role →' : 'Promote'}</button><button class="btn sm">History</button></div>
          </div></div></div>`
      if (step >= 3) {
        $('mem_role').closest('.row')?.classList.remove('hidden')
        $('mem_role').style.boxShadow = '0 0 0 3px rgba(10,133,119,.18)'
      } else $('mem_role').style.boxShadow = ''
      if (promoted) {
        $('reconcile_banner').classList.remove('hidden')
        $('reconcile_banner').style.display = 'block'
      }
    }

    if (scene === 'builder') {
      $('builderView').classList.remove('hidden')
      $('bv_co').textContent = 'Northstar Labs'
      $('bv_role').textContent = 'Senior Product Engineer'
      $('bv_col').textContent = 'Researched'
      $('bv_topscore').textContent = 'Match score 82%'
      $('bv_matchpct').textContent = '82%'
      $('bv_matchhint').textContent = 'Strong materials overlap'
      $('bv_frac').innerHTML = '7 of 9<small> requirements in materials</small>'
      $('bv_basis').textContent = 'Based on the seeded resume and this job description.'
      $('bv_empty').classList.toggle('hidden', step >= 2)
      $('rp2_editor').classList.toggle('hidden', step < 2)
      $('rp2_pick').innerHTML = `
        <div class="rp2-role"><div class="rp2-rolehd"><b>Northstar Labs — Senior Product Engineer</b></div>
        <div class="rp2-bul on"><input type="checkbox" checked><span class="t">Reduced rollback time through health checks and runbooks.</span><button class="rp2-link">Edit</button></div>
        <div class="rp2-bul ${step >= 1 ? 'on' : ''}"><input type="checkbox" ${step >= 1 ? 'checked' : ''}><span class="t">Built a release dashboard used by four product teams.</span><button class="rp2-link">Edit</button></div></div>
        <div class="rp2-role"><div class="rp2-rolehd"><b>Bluebird Systems — Software Engineer</b></div>
        <div class="rp2-bul ${step >= 1 ? 'on' : ''}"><input type="checkbox" ${step >= 1 ? 'checked' : ''}><span class="t">Designed event-driven workflows for customer onboarding.</span><button class="rp2-link">Edit</button></div></div>`
      $('rp2_pickstat').textContent = step >= 1 ? '3 of 3 experience bullets picked — saved for this job.' : '1 of 3 experience bullets picked.'
      $('bv_gaps').innerHTML = '<span class="chip">Kubernetes</span> <span class="chip">incident leadership</span>'
      $('bv_gapnote').textContent = 'Only add a gap if it is true and supported.'
      $('rp2_edtext').value = `DEMO CANDIDATE\nSenior Product Engineer\n\nSUMMARY\nProduct engineer focused on reliable delivery systems and evidence-driven operations.\n\nEXPERIENCE\nNorthstar Labs — Senior Product Engineer\n• Reduced rollback time through health checks and runbooks.\n• Built a release dashboard used by four product teams.\n\nBluebird Systems — Software Engineer\n• Designed event-driven workflows for customer onboarding.\n\nSKILLS\nTypeScript · Distributed systems · Delivery reliability`
      $('bv_verpill').textContent = step >= 3 ? 'Version 2 · saved' : 'Draft · check every line'
      $('bv_saved').classList.toggle('hidden', step < 3)
    }

    if (scene === 'interview' || scene === 'offers') {
      activate('board')
      board(3)
      $('drawer').classList.remove('hidden')
      $('scrim').classList.remove('hidden')
      $('dw_co').textContent = scene === 'interview' ? 'Northstar Labs' : 'Orbit & Pine'
      $('dw_role').textContent = scene === 'interview' ? 'Senior Product Engineer' : 'Principal Engineer'
      // Interview/offer live inside collapsed "More tools" details — open it and
      // replace the drawer body so the demo content is actually visible.
      const more = $('drawer')?.querySelector('details.more-tools')
      if (more) more.open = true
      const body = $('drawer')?.querySelector('.drawer-b')
      if (!body) return
      if (scene === 'interview') {
        const rounds = step < 1
          ? '<p class="muted" style="margin:0">No rounds added yet.</p>'
          : `<div class="demo-surface"><b>Round 1 · Hiring manager</b><div class="muted" style="margin-top:4px">Aug 6 · 30 minutes · video</div></div>`
        const prep = step < 2 ? '' : `<div class="interview-box" style="margin-top:12px"><h4>Interview prep · grounded in your story bank</h4>
          <div class="demo-grid">
            <div><span class="demo-kicker">Likely question</span><p>Tell me about a release that did not go as planned.</p></div>
            <div><span class="demo-kicker">Use this evidence</span><p>Health-check standardization and rollback runbook.</p></div>
            <div><span class="demo-kicker">Structure</span><p>Situation → decision → action → observed result.</p></div>
            <div><span class="demo-kicker">Do not invent</span><p>No unsupported percentages or team-size claims.</p></div>
          </div></div>`
        body.innerHTML = `<div class="section">
          <div class="lbl">Interview rounds</div>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">Track screen / onsite / loop dates. Follow-ups use these dates when present.</p>
          ${rounds}
          <div class="lbl" style="margin-top:14px">Interview prep</div>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">Angles from your story bank — copy only, never sends.</p>
          <button type="button" class="btn sm ${step >= 2 ? 'primary' : ''}">${step >= 2 ? 'Angles ready ✓' : 'Build interview angles'}</button>
          ${prep}
        </div>`
      } else {
        const compare = step < 2
          ? `<div class="demo-surface"><b>${step ? 'Two offers selected' : 'Choose 2–3 offer outcomes'}</b>
              <p class="muted" style="margin:8px 0 0">Empty fields stay blank. CareerOps never estimates compensation.</p></div>`
          : `<div class="oc-pick"><label><input type="checkbox" checked> Orbit & Pine</label><label><input type="checkbox" checked> Cedar Studio</label></div>
          <table><thead><tr><th>Offer</th><th>Base</th><th>Bonus</th><th>Work mode</th><th>Deadline</th></tr></thead>
          <tbody><tr><td><b>Orbit & Pine</b><br>Principal Engineer</td><td>$184,000</td><td>$18,000</td><td>Remote</td><td>Aug 14</td></tr>
          <tr><td><b>Cedar Studio</b><br>Engineering Lead</td><td>$176,000</td><td>$24,000</td><td>Hybrid</td><td>Aug 12</td></tr></tbody></table>
          <p class="muted" style="margin-top:10px">Your entered terms only · no market estimates · no invented fields</p>`
        body.innerHTML = `<div class="section offer-compare">
          <div class="lbl">Compare offers</div>
          <p class="muted" style="margin:0 0 8px;font-size:12.5px">Side-by-side for 2–3 roles with an Offer outcome.</p>
          ${compare}
        </div>`
      }
    }
  }, { scene, step, caption })
}

const optimizePng = async (name, scene, step, caption) => {
  await render(scene, step, caption)
  const tmp = path.join(frames, `${name}.png`)
  await page.screenshot({ path: tmp, animations: 'disabled' })
  await sharp(tmp).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(path.join(out, name))
}

const makeGif = async (name, scene, captions) => {
  const raws = []
  for (let i = 0; i < captions.length; i++) {
    await render(scene, i, captions[i])
    const png = await page.screenshot({ animations: 'disabled' })
    const raw = await sharp(png).resize(960, 600, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
    raws.push(raw)
  }
  await sharp(Buffer.concat(raws), {
    raw: { width: 960, height: 600 * raws.length, channels: 4, pageHeight: 600 },
  }).gif({ loop: 0, delay: captions.map(() => 4000), colours: 128, dither: 0.4 })
    .toFile(path.join(out, name))
}

await optimizePng('dashboard.png', 'board', 0, '')
await optimizePng('resume-builder.png', 'builder', 2, '')
await optimizePng('bullet-memory.png', 'memory', 4, '')
await optimizePng('interview-prep.png', 'interview', 2, '')
await optimizePng('offer-compare.png', 'offers', 2, '')

await makeGif('memory-promote.gif', 'memory', [
  'Open Memory',
  'Capture a true accomplishment',
  'Save it with immutable original text',
  'Choose the matching resume role',
  'Promote with bidirectional source links',
])
await makeGif('tailor-resume.gif', 'builder', [
  'Open the job-specific resume builder',
  'Pick only supported experience',
  'Generate a grounded first draft',
  'Save a new version — never overwrite',
  'Review every line before sending',
])
await makeGif('interview-prep.gif', 'interview', [
  'Open an interview-stage role',
  'Track the next interview round',
  'Build angles from your story bank',
  'Map evidence to likely questions',
  'Keep unsupported claims out',
])
await makeGif('application-board.gif', 'board', [
  'Start with a scored role',
  'Research before applying',
  'Track the application after you submit',
  'Prepare for interviews from the same evidence',
  'CareerOps tracks — it never auto-applies',
])
await makeGif('offer-compare.gif', 'offers', [
  'Open an offer-stage role',
  'Select offers to compare',
  'Compare the terms you entered',
  'Leave unknown fields blank',
  'Decide with facts, not invented estimates',
])

await browser.close()
await rm(frames, { recursive: true, force: true })
