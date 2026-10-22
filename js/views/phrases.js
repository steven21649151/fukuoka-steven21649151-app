// 日英字卡：上方切 🇯🇵 日文／🇬🇧 English，橫向 chip 切場景；
// 日文卡＝中文＋日文＋羅馬拼音，英文卡＝英文大字＋中文；都有 🔊 朗讀與大字卡
import { escapeHtml } from '../lib/md.js';
import { mdInline } from '../lib/md.js';
import { openBigCard } from '../lib/bigcard.js';
import { getVoice, speak, stopSpeak, hasTTS } from '../lib/tts.js';
import { getPrevHash } from '../router.js';

const LS_LANG = 'phrases.lang';
const LANGS = [
  { key: 'ja', label: '🇯🇵 日文', speech: 'ja-JP', name: '日文' },
  { key: 'en', label: '🇬🇧 English', speech: 'en-US', name: '英文' },
];
const sceneLang = (s) => s.lang || 'ja';

export async function render(root, params, ctx) {
  const scenes  = ctx.data.scenes || [];
  const phrases = ctx.data.phrases || [];
  const info    = ctx.data.emergencyInfo || null;

  // 場景排序：日文的 allergy 一定第一；英文照資料順序（機場、飯店、會場）
  const orderedScenes = scenes.slice().sort((a, b) => {
    if (a.key === 'allergy') return -1;
    if (b.key === 'allergy') return 1;
    return 0;
  });
  const scenesOf = (lang) => orderedScenes.filter(s => sceneLang(s) === lang);

  // 語言：網址有 scene 以網址為準（行程卡的 文A 就是靠這個跳轉），否則用上次記住的
  const qScene = params?.query?.scene || null;
  const qSceneObj = qScene ? orderedScenes.find(s => s.key === qScene) : null;
  let lang = qSceneObj ? sceneLang(qSceneObj) : null;
  if (!lang) { try { lang = localStorage.getItem(LS_LANG); } catch { /* ignore */ } }
  if (lang !== 'en') lang = 'ja';
  let sceneKey = qSceneObj ? qSceneObj.key : (scenesOf(lang)[0]?.key || 'allergy');

  // 返回：從行程卡過來就回行程（scrollMemory 會把捲動位置還原），否則回小工具
  const prev = getPrevHash() || '';
  const dm = /^#\/day\/(\d+)/.exec(prev);
  const back = dm ? { href: prev, label: '← 回行程' } : { href: '#/tools', label: '← 回小工具' };

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="${escapeHtml(back.href)}">${back.label}</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">日英字卡</h1>
      <p class="small faint" style="margin-bottom:10px">
        點 🔊 朗讀；點 <b>大字卡</b> 進黑底白字模式，把手機轉過去給對方看。
      </p>
      <div class="ext-row" style="margin-bottom:10px">
        <a class="ext-btn" href="https://translate.google.com/?sl=ja&tl=zh-TW&op=translate" target="_blank" rel="noopener">
          <span class="ico">🌐</span>
          <span class="lbl">Google 翻譯</span>
          <span class="ext-hint">會開 App 或網頁版</span>
        </a>
      </div>

      <div class="lang-seg" id="langSeg" role="group" aria-label="語言">
        ${LANGS.map(l => `<button type="button" class="seg${l.key === lang ? ' on' : ''}" data-lang="${l.key}">${l.label}</button>`).join('')}
      </div>

      <nav class="chiprow" id="sceneChips" aria-label="場景切換"></nav>

      <div id="phraseList" class="phrase-list"></div>
    </div>
  `;

  const listEl = root.querySelector('#phraseList');
  const chipsEl = root.querySelector('#sceneChips');
  const langSeg = root.querySelector('#langSeg');

  function paintChips() {
    chipsEl.innerHTML = scenesOf(lang).map(s => `
      <button type="button" class="chip" data-scene="${escapeHtml(s.key)}"
              ${s.key === sceneKey ? 'aria-current="true"' : ''}>
        ${escapeHtml(s.label || s.key)}
      </button>
    `).join('');
  }
  function setHashScene(key) {
    const cur = location.hash.split('?')[0];
    history.replaceState(null, '', `${cur}?scene=${encodeURIComponent(key)}`);   // 不重新跑 view
  }

  langSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (!b || b.dataset.lang === lang) return;
    lang = b.dataset.lang;
    try { localStorage.setItem(LS_LANG, lang); } catch { /* ignore */ }
    langSeg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    sceneKey = scenesOf(lang)[0]?.key || sceneKey;     // 切換語言時預設選該語言的第一個場景
    paintChips();
    renderScene(sceneKey);
    setHashScene(sceneKey);
  });

  chipsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-scene]');
    if (!btn) return;
    sceneKey = btn.getAttribute('data-scene');
    chipsEl.querySelectorAll('button').forEach(b => b.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'true');
    renderScene(sceneKey);
    setHashScene(sceneKey);
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
        let list = phrases
          .filter(p => p.scene === sceneKey)
          .sort((a, b) => (a.priority || 99) - (b.priority || 99));
        const bigOnly = list.filter(p => p.bigCard);
        if (bigOnly.some(p => p.id === id)) list = bigOnly;
        openBigCard(list, { startId: id });
      });
    });
  }

  async function onSpeakClick(btn) {
    const L = btn.getAttribute('data-lang') || 'ja';
    if (!hasTTS()) {
      showTTSFallback(L);
      return;
    }
    // 已經在唸這一句 → 停止
    if (btn.classList.contains('speaking')) {
      stopSpeak();
      btn.classList.remove('speaking');
      return;
    }
    const text = btn.getAttribute('data-text') || '';
    if (!text) return;
    const speech = L === 'en' ? 'en-US' : 'ja-JP';
    // 預熱過的話這裡瞬間回來；沒預熱就等 voiceschanged
    // 注意：iOS Safari 要求 speak() 同步在點擊事件裡呼叫 → 先 speak，再由 tts.js 內部套 voice
    getVoice(L); // 預熱一次

    // 標記所有正在唸的按鈕為停止
    listEl.querySelectorAll('.speak-btn.speaking').forEach(b => b.classList.remove('speaking'));
    btn.classList.add('speaking');

    speak(text, { lang: speech }, (err) => {
      btn.classList.remove('speaking');
      if (err && err.message === 'no-tts') showTTSFallback(L);
    });
  }

  function showTTSFallback(L) {
    if (root.querySelector('.tts-fallback')) return;
    const name = L === 'en' ? '英文' : '日文';
    const el = document.createElement('div');
    el.className = 'tts-fallback';
    el.innerHTML = `
      <div class="body">
        <b>這台裝置沒有這個語言的語音。</b><br>
        可以到 <b>設定 → 語言與輸入 → 文字轉語音</b> 下載 Google ${name}語音包。
        在那之前，用下面的 <b>大字卡</b> 直接給對方看。
      </div>
      <button type="button" class="close" aria-label="關閉">✕</button>
    `;
    el.querySelector('.close').addEventListener('click', () => el.remove());
    root.querySelector('.wrap').insertBefore(el, root.querySelector('#phraseList'));
  }

  getVoice('ja'); getVoice('en');   // 預熱兩種語音
  paintChips();
  renderScene(sceneKey);
}

function renderPhraseCard(p) {
  const en = p.lang === 'en';
  const noteHtml = p.note
    ? `<div class="phrase-note"><span class="ico">💡</span><span>${mdInline(p.note)}</span></div>`
    : '';
  const bigBtn = p.bigCard
    ? `<button type="button" class="btn bigcard-btn" data-id="${escapeHtml(p.id)}">🖼 大字卡</button>`
    : '';
  const speakText = en ? (p.en || '') : (p.ja || '');
  const body = en
    ? `<div class="phrase-ja phrase-en" lang="en">${escapeHtml(p.en || '')}</div>
       <div class="phrase-zh phrase-zh-under">${escapeHtml(p.zh || '')}</div>`
    : `<div class="phrase-zh">${escapeHtml(p.zh || '')}</div>
       <div class="phrase-ja" lang="ja">${escapeHtml(p.ja || '')}</div>
       <div class="phrase-romaji">${escapeHtml(p.romaji || '')}</div>`;
  return `
    <article class="phrase-card" data-id="${escapeHtml(p.id)}" data-lang="${en ? 'en' : 'ja'}">
      ${body}
      ${noteHtml}
      <div class="phrase-actions">
        <button type="button" class="btn speak-btn" data-text="${escapeHtml(speakText)}" data-lang="${en ? 'en' : 'ja'}" aria-label="朗讀">
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
