// 匯率換算頁：來源標示、手動覆寫、雙向換算
import { escapeHtml } from '../lib/md.js';
import { yen, twdExact } from '../lib/fmt.js';
import { getRate, setOverride, clearOverride, onChange as onRateChange, formatFetchedAt } from '../lib/rate.js';

export async function render(root, params, ctx) {
  const baseFromJson = ctx.data.rate;

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">匯率</h1>

      <div class="rate-hero" id="rateHero"></div>

      <section class="section">
        <h2>換算</h2>
        <div class="converter">
          <label>
            <span>日圓 ¥</span>
            <input id="jpy" inputmode="decimal" placeholder="例：1000">
          </label>
          <div class="approx" id="jpyPreview">≈ NT$—</div>

          <div class="divider"></div>

          <label>
            <span>台幣 NT$</span>
            <input id="twd" inputmode="decimal" placeholder="例：200">
          </label>
          <div class="approx" id="twdPreview">≈ ¥—</div>
        </div>
      </section>

      <section class="section">
        <h2>手動覆寫</h2>
        <div class="rate-override">
          <p class="small faint">
            自己輸一個比率會蓋過線上抓到的值——例如你已經在銀行換過鈔、想用實際換到的匯率記帳。
          </p>
          <div class="rate-override-row">
            <label>
              <span>¥1 = NT$</span>
              <input id="overrideInput" inputmode="decimal" placeholder="例：0.2145" step="0.0001">
            </label>
            <button type="button" class="btn btn-primary" id="applyOverride">套用</button>
            <button type="button" class="btn" id="clearOverride">恢復自動</button>
          </div>
          <div class="small faint" id="overrideState"></div>
        </div>
      </section>
    </div>
  `;

  const heroEl        = root.querySelector('#rateHero');
  const jpyInput      = root.querySelector('#jpy');
  const twdInput      = root.querySelector('#twd');
  const jpyPreview    = root.querySelector('#jpyPreview');
  const twdPreview    = root.querySelector('#twdPreview');
  const overrideInput = root.querySelector('#overrideInput');
  const overrideState = root.querySelector('#overrideState');
  const applyBtn      = root.querySelector('#applyOverride');
  const clearBtn      = root.querySelector('#clearOverride');

  function paint() {
    const r = getRate();
    heroEl.innerHTML = renderHero(r);
    // 更新換算 preview
    if (jpyInput.value) jpyInput.dispatchEvent(new Event('input'));
    if (twdInput.value) twdInput.dispatchEvent(new Event('input'));
    // 覆寫狀態
    if (r.tag === 'override') {
      overrideState.textContent = `目前使用手動值 ¥1 = NT$${r.jpyToTwd.toFixed(4)}`;
      overrideInput.placeholder = r.jpyToTwd.toFixed(4);
      clearBtn.disabled = false;
    } else {
      overrideState.textContent = '目前沒有覆寫，跟著線上／基準值走。';
      clearBtn.disabled = true;
    }
  }

  jpyInput.addEventListener('input', () => {
    const v = parseFloat(jpyInput.value);
    if (isNaN(v)) { jpyPreview.textContent = '≈ NT$—'; return; }
    jpyPreview.textContent = '≈ ' + twdExact(v, getRate().jpyToTwd);
  });
  twdInput.addEventListener('input', () => {
    const v = parseFloat(twdInput.value);
    if (isNaN(v)) { twdPreview.textContent = '≈ ¥—'; return; }
    twdPreview.textContent = '≈ ' + yen(v / getRate().jpyToTwd);
  });

  applyBtn.addEventListener('click', () => {
    const v = parseFloat(overrideInput.value);
    if (!Number.isFinite(v) || v <= 0) {
      overrideState.textContent = '請輸入大於 0 的數字（例如 0.2145）';
      return;
    }
    setOverride(v, baseFromJson);
    overrideInput.value = '';
  });
  clearBtn.addEventListener('click', () => clearOverride(baseFromJson));

  const off = onRateChange(paint);
  // view 換掉時解除
  window.addEventListener('hashchange', off, { once: true });

  paint();
}

function renderHero(r) {
  const preview = twdExact(100, r.jpyToTwd);
  return `
    <div class="rate-line">
      <span class="mono nw">¥100</span>
      <span class="arrow">≈</span>
      <span class="mono nw" id="ratepreview">${escapeHtml(preview)}</span>
    </div>
    <div class="rate-meta">
      <div>目前匯率：<span class="mono">¥1 = NT$${r.jpyToTwd.toFixed(4)}</span> ${renderTag(r)}</div>
      <div>來源：<span>${escapeHtml(r.source || '未知')}</span>${r.asOf ? `　更新於 <span class="mono">${escapeHtml(fmtAsOf(r))}</span>` : ''}</div>
      ${renderCaveat(r)}
    </div>
  `;
}

function renderTag(r) {
  if (r.tag === 'override') return `<span class="rate-tag override">手動</span>`;
  if (r.tag === 'live')     return `<span class="rate-tag live">即時</span>`;
  if (r.tag === 'stale')    return `<span class="rate-tag stale">舊值</span>`;
  return `<span class="rate-tag base">基準</span>`;
}

function fmtAsOf(r) {
  // override: 無時間；live/stale: fetchedAt ISO；base: 日期字串
  if (r.tag === 'live' || r.tag === 'stale') return formatFetchedAt(r.asOf);
  return r.asOf || '';
}

function renderCaveat(r) {
  if (r.tag === 'live')   return `<div class="faint tiny" style="margin-top:6px">即期參考匯率，實際換鈔以銀行現金賣出為準，通常略差 1–2%。</div>`;
  if (r.tag === 'stale')  return `<div class="faint tiny" style="margin-top:6px">目前離線或抓不到最新值，用的是先前抓到的即期參考。</div>`;
  if (r.tag === 'base')   return `<div class="faint tiny" style="margin-top:6px">內建基準值。有網路時會自動更新為即期參考。</div>`;
  if (r.tag === 'override') return `<div class="faint tiny" style="margin-top:6px">你設定的值。按「恢復自動」會回到線上／基準值。</div>`;
  return '';
}
