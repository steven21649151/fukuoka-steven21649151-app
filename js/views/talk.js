// 我的報告頁：倒數、關鍵時間、時間分配比例條、報告前 checklist、英文 Q&A（可朗讀）
import { escapeHtml, mdInline } from '../lib/md.js';
import { md as mdDate } from '../lib/fmt.js';
import { getVoice, speak, stopSpeak, hasTTS, hasVoice } from '../lib/tts.js';

const LS_PREFIX = 'talk.';
function isChecked(id) {
  try { return localStorage.getItem(LS_PREFIX + id) === '1'; } catch { return false; }
}
function setChecked(id, v) {
  try {
    if (v) localStorage.setItem(LS_PREFIX + id, '1');
    else localStorage.removeItem(LS_PREFIX + id);
  } catch {}
}

export async function render(root, params, ctx) {
  const talk = ctx.data.talk;
  if (!talk) {
    root.innerHTML = `
      <div class="wrap">
        <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
        <div class="empty">找不到 talk.json</div>
      </div>`;
    return;
  }

  const t = talk.target;
  const targetTime = new Date(t.iso);

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">🎤 我的報告</h1>
      <div class="small faint" style="margin-bottom:12px">
        ${escapeHtml(t.session)} · ${escapeHtml(t.room)} · ${escapeHtml(t.paperId)}（第 ${t.order} 位講者）
      </div>

      <section class="talk-count">
        <div class="k">距上台</div>
        <div class="v" id="talkCountdown"></div>
      </section>

      <section class="talk-block">
        <div class="talk-h">🕐 15 分鐘怎麼分配</div>
        <div class="talk-time-bar">
          <div class="seg talk" style="flex:${t.talkMin}"><span>講 ${t.talkMin} 分</span></div>
          <div class="seg qa"   style="flex:${t.qaMin}"><span>Q&amp;A ${t.qaMin}</span></div>
        </div>
        <div class="small faint" style="margin-top:4px">主席會在時間到時打斷。控制節奏比講完全部更重要。</div>
      </section>

      <section class="talk-block">
        <div class="talk-h">📅 關鍵時間</div>
        <ol class="talk-mile">
          ${talk.milestones.map(renderMilestone).join('')}
        </ol>
      </section>

      <section class="talk-block">
        <div class="talk-h">✅ 報告前檢查</div>
        <div class="talk-check" id="talkCheck">
          ${talk.checklist.map(renderCheck).join('')}
        </div>
      </section>

      <section class="talk-block">
        <div class="talk-h">💬 英文 Q&A 應答句</div>
        <div class="small faint" style="margin-bottom:8px">最容易當場卡住的環節。點 🔊 用英文唸一次。</div>
        <div class="qa-list">
          ${talk.qa.map(renderQA).join('')}
        </div>
      </section>
    </div>
  `;

  // countdown
  const cdEl = root.querySelector('#talkCountdown');
  function tickCd() {
    const now = new Date();
    const diff = targetTime - now;
    if (diff <= 0) { cdEl.textContent = '（開始了）'; return; }
    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / 60 / 24);
    const hours = Math.floor(totalMin / 60) % 24;
    const mins = totalMin % 60;
    cdEl.textContent = days > 0
      ? `${days} 天 ${hours} 小時`
      : hours > 0
        ? `${hours} 小時 ${mins} 分`
        : `${mins} 分`;
  }
  tickCd();
  const cdTimer = setInterval(tickCd, 60000);
  window.addEventListener('hashchange', () => clearInterval(cdTimer), { once: true });

  // checklist
  root.querySelectorAll('.talk-check input[type=checkbox]').forEach(cb => {
    const id = cb.getAttribute('data-id');
    cb.checked = isChecked(id);
    cb.closest('.talk-check-row').classList.toggle('done', cb.checked);
    cb.addEventListener('change', () => {
      setChecked(id, cb.checked);
      cb.closest('.talk-check-row').classList.toggle('done', cb.checked);
    });
  });

  // Q&A speak
  getVoice('en'); // warm up
  root.querySelectorAll('.qa-speak').forEach(btn => {
    btn.addEventListener('click', () => onSpeakEn(btn));
  });

  function onSpeakEn(btn) {
    if (!hasTTS()) return showTTSFallback();
    if (btn.classList.contains('speaking')) { stopSpeak(); btn.classList.remove('speaking'); return; }
    const text = btn.getAttribute('data-en') || '';
    if (!text) return;
    getVoice('en');
    root.querySelectorAll('.qa-speak.speaking').forEach(b => b.classList.remove('speaking'));
    btn.classList.add('speaking');
    speak(text, { lang: 'en-US' }, (err) => {
      btn.classList.remove('speaking');
      if (err && err.message === 'no-tts') showTTSFallback();
    });
  }
  function showTTSFallback() {
    if (root.querySelector('.tts-fallback')) return;
    const el = document.createElement('div');
    el.className = 'tts-fallback';
    el.innerHTML = `<div class="body"><b>這台裝置沒有語音朗讀功能。</b> 直接看下面的英文句子練口說也一樣有效。</div><button type="button" class="close" aria-label="關閉">✕</button>`;
    el.querySelector('.close').addEventListener('click', () => el.remove());
    root.querySelector('.wrap').insertBefore(el, root.querySelector('.qa-list').parentElement);
  }
}

function renderMilestone(m) {
  const d = new Date(m.iso);
  const isDateOnly = m.iso.length === 10;
  const md = `${d.getMonth()+1}/${d.getDate()}`;
  const hhmm = isDateOnly ? '' : ` ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  const now = new Date();
  const past = d < now;
  return `
    <li class="talk-mile-item ${past ? 'past' : ''}">
      <div class="stamp"><span class="mono">${md}${hhmm}</span></div>
      <div class="body">
        <div class="ttl">${escapeHtml(m.title)}</div>
        ${m.detail ? `<div class="det">${mdInline(m.detail)}</div>` : ''}
      </div>
    </li>
  `;
}

function renderCheck(it) {
  return `
    <label class="talk-check-row ${it.critical ? 'crit' : ''}">
      <input type="checkbox" data-id="${escapeHtml(it.id)}">
      <span class="text">${escapeHtml(it.text)}</span>
      ${it.critical ? '<span class="star">⭐</span>' : ''}
    </label>
  `;
}

function renderQA(q) {
  return `
    <article class="qa-card">
      <div class="zh">${escapeHtml(q.zh)}</div>
      <div class="en" lang="en">${escapeHtml(q.en)}</div>
      ${q.note ? `<div class="note">💡 ${escapeHtml(q.note)}</div>` : ''}
      <div class="acts">
        <button type="button" class="btn qa-speak" data-en="${escapeHtml(q.en)}" aria-label="用英文唸">
          <span class="ico">🔊</span><span>唸一次</span>
        </button>
      </div>
    </article>
  `;
}
