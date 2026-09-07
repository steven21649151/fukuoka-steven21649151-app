// 匯率換算
import { escapeHtml } from '../lib/md.js';
import { yen, twd } from '../lib/fmt.js';

export async function render(root, params, ctx) {
  const rate = ctx.data.rate || { jpyToTwd: 0.2035 };
  const r = rate.jpyToTwd;
  const asOf = rate.asOf ? escapeHtml(rate.asOf) : '未知';
  const source = rate.source ? escapeHtml(rate.source) : '未知';

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">匯率</h1>

      <div class="rate-hero">
        <div class="rate-line">
          <span class="mono nw">¥100</span>
          <span class="arrow">≈</span>
          <span class="mono nw" id="ratepreview">${escapeHtml(twd(100, r))}</span>
        </div>
        <div class="rate-meta">
          <div>目前匯率：<span class="mono">¥1 = NT$${r.toFixed(4)}</span></div>
          <div>更新於：<span class="mono">${asOf}</span>（${source}）</div>
          <div class="faint tiny" style="margin-top:6px">出發前記得手動更新 <code>data/rates.json</code>。</div>
        </div>
      </div>

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
    </div>
  `;

  const jpyInput = document.getElementById('jpy');
  const twdInput = document.getElementById('twd');
  const jpyPreview = document.getElementById('jpyPreview');
  const twdPreview = document.getElementById('twdPreview');

  jpyInput.addEventListener('input', () => {
    const v = parseFloat(jpyInput.value);
    if (isNaN(v)) { jpyPreview.textContent = '≈ NT$—'; return; }
    jpyPreview.textContent = '≈ ' + twd(v, r);
  });
  twdInput.addEventListener('input', () => {
    const v = parseFloat(twdInput.value);
    if (isNaN(v)) { twdPreview.textContent = '≈ ¥—'; return; }
    twdPreview.textContent = '≈ ' + yen(v / r);
  });
}
