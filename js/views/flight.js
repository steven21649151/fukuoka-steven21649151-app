// 航班頁：索引 + 硬資訊。流程細節連 guides.json 四份
import { escapeHtml, mdInline } from '../lib/md.js';
import { md } from '../lib/fmt.js';

export async function render(root, params, ctx) {
  const days = ctx.data.days || [];
  const flights = [];
  days.forEach(d => {
    (d.items || []).forEach(it => {
      if (it.kind === 'flight') flights.push({ day: d, it });
    });
  });

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">航班</h1>

      <section class="fl-section">
        <div class="fl-section-h">✈️ 兩班機</div>
        <div class="fl-flights">
          ${flights.map(renderFlight).join('')}
        </div>
      </section>

      <section class="fl-section fl-baggage">
        <div class="fl-section-h">🧳 行李規定</div>
        <ul class="fl-list">
          <li><b>去程</b>：託運 <span class="nw">2 × 23kg</span>、手提 <span class="nw">56×36×23cm</span>／<span class="nw">7kg</span></li>
          <li class="warn"><b>回程</b>：託運只有 <b><span class="nw">1 × 23kg</span></b>（少一件）、手提同上</li>
        </ul>
        <div class="fl-hint">
          <span class="ico">💡</span>
          <div class="body">去程只用一個行李箱、空出一個大軟袋放在裡面，回程裝戰利品當手提。<b>10/29 買一堆伴手禮，回程少一件託運要先想好。</b></div>
        </div>
      </section>

      <section class="fl-section">
        <div class="fl-section-h">🔋 鋰電池／行動電源</div>
        <div class="fl-note">
          <b>只能手提，不能託運。</b>100Wh 以下沒問題。這是最多人在機場被攔下來的一項。
          <a class="fl-inline-link" href="#/tools/tips?highlight=tp-battery">看整條攻略 →</a>
        </div>
      </section>

      <section class="fl-section">
        <div class="fl-section-h">📋 四份流程頁</div>
        <div class="fl-guides">
          <a class="fl-guide" href="#/guide/dep-tpe">
            <span class="tag">10/25</span>
            <span class="lbl">出發：桃園機場流程</span>
            <span class="chev">›</span>
          </a>
          <a class="fl-guide" href="#/guide/onboard">
            <span class="tag">機上</span>
            <span class="lbl">機上：填單、餐、廁所</span>
            <span class="chev">›</span>
          </a>
          <a class="fl-guide" href="#/guide/arr-fuk">
            <span class="tag">10/25</span>
            <span class="lbl">落地：福岡入境流程</span>
            <span class="chev">›</span>
          </a>
          <a class="fl-guide" href="#/guide/dep-fuk">
            <span class="tag">10/30</span>
            <span class="lbl">回程：福岡出境流程</span>
            <span class="chev">›</span>
          </a>
        </div>
      </section>

      <section class="fl-section">
        <div class="fl-section-h">🚇 機場交通</div>
        <ul class="fl-list">
          <li><b>桃園 T2</b>：自行前往（機捷／客運／自駕）。班機 08:00，抓 2h45 到，也就是 05:15 前要進航廈。</li>
          <li><b>福岡機場</b>國際線 → 國內線：<span class="nw">免費接駁 10 分</span>。地鐵入口在<b>國內線</b>那棟。</li>
          <li><b>地鐵空港線</b>：福岡空港站 → 天神站約 <span class="nw">11 分</span>、<span class="nw">¥260</span>。可以嗶信用卡感應。</li>
        </ul>
      </section>

      <section class="fl-section">
        <div class="fl-section-h">💰 加購行李</div>
        <div class="fl-note faint">
          需要的話出發前到長榮官網加買，比機場現場便宜。<b>機場現場加購比較貴。</b>
        </div>
      </section>
    </div>
  `;
}

function renderFlight({ day, it }) {
  const title = it.title || '';
  // 標題格式：「長榮 BR106　桃園 T2 → 福岡」——用全形空格分航空/航段，用 → 分起訖
  let airline = title;
  let from = '';
  let to = '';
  const parts = title.split('　');
  if (parts.length >= 2) {
    airline = parts[0].trim();
    const rest = parts.slice(1).join('　');
    const arrow = rest.split(/\s*→\s*/);
    from = (arrow[0] || '').trim();
    to = (arrow[1] || '').trim();
  }

  // 航班跨時區，時鐘相減會錯 → 一律用資料的 durationMin
  const durMin = Number.isFinite(it.durationMin) ? it.durationMin : timeDurationMin(it.time, it.endTime);
  const dur = durMin ? `${Math.floor(durMin / 60)} 小時 ${durMin % 60} 分` : '';
  const dateStr = day.date ? `${md(day.date)}（${day.weekday || ''}）` : '';

  return `
    <article class="fl-card">
      <div class="fl-head">
        <span class="fl-flag">✈️</span>
        <div class="fl-name">
          <div class="fl-airline">${escapeHtml(airline)}</div>
          <div class="fl-date">${escapeHtml(dateStr)}</div>
        </div>
      </div>
      ${from && to ? `
        <div class="fl-route">
          <div class="fl-city">
            <div class="fl-time mono">${escapeHtml(it.time || '')}</div>
            <div class="fl-place">${escapeHtml(from)}</div>
          </div>
          <div class="fl-line">
            <span class="dash"></span>
            <span class="dur">${escapeHtml(dur)}</span>
            <span class="dash"></span>
          </div>
          <div class="fl-city">
            <div class="fl-time mono">${escapeHtml(it.endTime || '')}</div>
            <div class="fl-place">${escapeHtml(to)}</div>
          </div>
        </div>
      ` : ''}
      ${it.guideId ? `
        <a class="fl-card-link" href="#/guide/${encodeURIComponent(it.guideId)}">看流程 →</a>
      ` : ''}
    </article>
  `;
}

function timeDurationMin(a, b) {
  if (!a || !b) return 0;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let mins = (bh * 60 + bm) - (ah * 60 + am);
  if (mins < 0) mins += 24 * 60;
  return mins;
}
