// 中日句庫：橫向 chip 切場景，每張卡中日 romaji + 🔊 + 大字卡按鈕
import { escapeHtml } from '../lib/md.js';
import { mdInline } from '../lib/md.js';
import { openBigCard } from '../lib/bigcard.js';
import { getJaVoice, speakJa, stopSpeak, hasTTS } from '../lib/tts.js';

export async function render(root, params, ctx) {
  const scenes  = ctx.data.scenes || [];
  const phrases = ctx.data.phrases || [];
  const info    = ctx.data.emergencyInfo || null;

  // 場景排序：allergy 一定第一
  const orderedScenes = scenes.slice().sort((a, b) => {
    if (a.key === 'allergy') return -1;
    if (b.key === 'allergy') return 1;
    return 0;
  });

  const initialScene = params?.query?.scene || orderedScenes[0]?.key || 'allergy';

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">中日句庫</h1>
      <p class="small faint" style="margin-bottom:10px">
        點 🔊 朗讀；點 <b>大字卡</b> 進黑底白字模式，把手機轉過去給店員看。
      </p>

      <nav class="chiprow" id="sceneChips" aria-label="場景切換">
        ${orderedScenes.map(s => `
          <button type="button" class="chip" data-scene="${escapeHtml(s.key)}"
                  ${s.key === initialScene ? 'aria-current="true"' : ''}>
            ${escapeHtml(s.label || s.key)}
          </button>
        `).join('')}
      </nav>

      <div id="phraseList" class="phrase-list"></div>
    </div>
  `;

  const listEl = root.querySelector('#phraseList');
  const chipsEl = root.querySelector('#sceneChips');

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scene]');
    if (!btn) return;
    const key = btn.getAttribute('data-scene');
    chipsEl.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
    renderScene(key);
    // 更新 hash 的 scene（不重新跑 view）
    const cur = location.hash.split('?')[0];
    history.replaceState(null, '', `${cur}?scene=${encodeURIComponent(key)}`);
  });

  function renderScene(key) {
    const list = phrases
      .filter(p => p.scene === key)
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));

    let html = '';
    if (key === 'emergency' && info) {
      html += renderEmergencyInfo(info);
    }
    if (list.length === 0) {
      html += `<div class="empty">這個場景還沒有句子</div>`;
    } else {
      html += list.map(renderPhraseCard).join('');
    }
    listEl.innerHTML = html;
    wirePhraseCards();
  }

  function wirePhraseCards() {
    listEl.querySelectorAll('.speak-btn').forEach(btn => {
      btn.addEventListener('click', () => onSpeakClick(btn));
    });
    listEl.querySelectorAll('.bigcard-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        // 開該場景下的一整組（bigCard 為主，若沒有就用全部）
        const curScene = chipsEl.querySelector('button[aria-current="true"]')?.getAttribute('data-scene');
        let list = phrases
          .filter(p => p.scene === curScene)
          .sort((a, b) => (a.priority || 99) - (b.priority || 99));
        const bigOnly = list.filter(p => p.bigCard);
        if (bigOnly.some(p => p.id === id)) list = bigOnly;
        openBigCard(list, { startId: id });
      });
    });
  }

  async function onSpeakClick(btn) {
    if (!hasTTS()) {
      showTTSFallback();
      return;
    }
    // 已經在唸這一句 → 停止
    if (btn.classList.contains('speaking')) {
      stopSpeak();
      btn.classList.remove('speaking');
      return;
    }
    const text = btn.getAttribute('data-ja') || '';
    if (!text) return;
    // 預熱過的話這裡瞬間回來；沒預熱就等 voiceschanged
    // 注意：iOS Safari 要求 speak() 同步在點擊事件裡呼叫 → 先 speak，再由 tts.js 內部套 voice
    // 若真的還拿不到 voice，speechSynthesis 也會用系統預設嘗試
    getJaVoice(); // 預熱一次

    // 標記所有正在唸的按鈕為停止
    listEl.querySelectorAll('.speak-btn.speaking').forEach(b => b.classList.remove('speaking'));
    btn.classList.add('speaking');

    speakJa(text, (err) => {
      btn.classList.remove('speaking');
      if (err && err.message === 'no-tts') showTTSFallback();
    });
  }

  function showTTSFallback() {
    if (root.querySelector('.tts-fallback')) return;
    const el = document.createElement('div');
    el.className = 'tts-fallback';
    el.innerHTML = `
      <div class="body">
        <b>這台裝置沒有日文語音。</b><br>
        可以到 <b>設定 → 語言與輸入 → 文字轉語音</b> 下載 Google 日文語音包。
        在那之前，用下面的 <b>大字卡</b> 直接給店員看。
      </div>
      <button type="button" class="close" aria-label="關閉">✕</button>
    `;
    el.querySelector('.close').addEventListener('click', () => el.remove());
    root.querySelector('.wrap').insertBefore(el, root.querySelector('#phraseList'));
  }

  renderScene(initialScene);
}

function renderPhraseCard(p) {
  const noteHtml = p.note
    ? `<div class="phrase-note"><span class="ico">💡</span><span>${mdInline(p.note)}</span></div>`
    : '';
  const bigBtn = p.bigCard
    ? `<button type="button" class="btn bigcard-btn" data-id="${escapeHtml(p.id)}">🖼 大字卡</button>`
    : '';
  return `
    <article class="phrase-card" data-id="${escapeHtml(p.id)}">
      <div class="phrase-zh">${escapeHtml(p.zh || '')}</div>
      <div class="phrase-ja" lang="ja">${escapeHtml(p.ja || '')}</div>
      <div class="phrase-romaji">${escapeHtml(p.romaji || '')}</div>
      ${noteHtml}
      <div class="phrase-actions">
        <button type="button" class="btn speak-btn" data-ja="${escapeHtml(p.ja || '')}" aria-label="朗讀">
          <span class="speak-ico">🔊</span><span class="speak-label">唸一次</span>
        </button>
        ${bigBtn}
      </div>
    </article>
  `;
}

function renderEmergencyInfo(info) {
  const rows = [];
  if (info.police) rows.push(row('警察', info.police));
  if (info.fireAmbulance) rows.push(row('消防／救護車', info.fireAmbulance));
  if (info.japanVisitorHotline) rows.push(row(info.japanVisitorHotline.name, info.japanVisitorHotline.tel));
  if (info.taipeiOffice) {
    const o = info.taipeiOffice;
    rows.push(row(o.name + '（一般）', o.tel));
    if (o.emergency) rows.push(row(o.name + '（急難救助）', o.emergency));
  }
  return `
    <section class="emergency-info">
      <div class="lead">🚨 出事時打這裡</div>
      <ul>${rows.join('')}</ul>
      ${info.taipeiOffice?.address ? `<div class="addr">${escapeHtml(info.taipeiOffice.name)}｜${escapeHtml(info.taipeiOffice.address)}</div>` : ''}
      ${info.taipeiOffice?.note ? `<div class="note">${escapeHtml(info.taipeiOffice.note)}</div>` : ''}
    </section>
  `;
}
function row(label, tel) {
  const clean = String(tel).replace(/[^\d+]/g, '');
  return `
    <li>
      <span class="k">${escapeHtml(label)}</span>
      <a class="tel" href="tel:${escapeHtml(clean)}">${escapeHtml(tel)}</a>
    </li>
  `;
}
