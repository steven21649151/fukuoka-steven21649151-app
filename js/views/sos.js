// 出事了頁：三種狀況，照著做的步驟。電話一律 tel: 連結。
import { escapeHtml } from '../lib/md.js';

export async function render(root, params, ctx) {
  const info = ctx.data.emergencyInfo || {};
  const tel = (t) => String(t || '').replace(/[^\d+]/g, '');

  root.innerHTML = `
    <div class="wrap">
      <div class="topnav"><a class="back" href="#/tools">← 回小工具</a></div>
      <h1 style="font-family:var(--dis);font-size:22px;margin:14px 0 6px">🚨 出事了</h1>
      <p class="small faint" style="margin-bottom:12px">
        照著上面往下做。<b>電話點下去會直接撥。</b>
      </p>

      <section class="sos-card">
        <div class="sos-h">🛂 護照不見了</div>
        <ol class="sos-steps">
          <li>
            <b>先到最近的交番（派出所）報遺失</b>——他們會給你一張「盗難／紛失届出証明書」，
            補發護照要用。日本的遺失物尋回率高，先做這步。
            <div class="sos-line">警察 <a class="tel" href="tel:110">110</a></div>
          </li>
          <li>
            <b>打電話到台北駐福岡經濟文化辦事處</b>——問補發流程、要帶什麼。
            護照遺失走急難救助專線。
            ${renderOfficeContacts(info.taipeiOffice)}
          </li>
          <li>
            <b>備齊補辦文件</b>——警察遺失證明、身分證正本／影本、大頭照 2 張、
            機票或行程證明（證明你有回台需求）。
            <div class="small faint" style="margin-top:4px">
              打包清單那條「護照影本 + 大頭照（實體與雲端各一份）」如果有做，這裡會快很多。
            </div>
          </li>
          <li>
            <b>時程</b>：辦事處核發臨時入國證明書當日可拿到（用於返台單程）。
            正式護照補發要 5–7 個工作天，回台後再補辦即可。
          </li>
        </ol>
      </section>

      <section class="sos-card">
        <div class="sos-h">💳 卡不能用／沒現金</div>
        <ol class="sos-steps">
          <li>
            <b>第一件事：判斷是不是感應累計額度到了。</b>
            郵局 VISA 有隱藏規則——累計到一定額度後要插卡輸密碼才能繼續感應。
            <div class="sos-line">
              <a class="btn" href="#/tools/tips?highlight=tp-postvisa">看這條攻略 →</a>
            </div>
          </li>
          <li>
            <b>去 7-11 用 Seven Bank ATM 領現金。</b>
            日本最可靠能吃外國卡的機器，24 小時。就算晶片被鎖，記得密碼還能領。
          </li>
          <li>
            <b>如果是卡遺失或被吞</b>——立刻打國際免付費電話掛失：
            <div class="sos-line">
              中華郵政 24 小時客服 <a class="tel" href="tel:+886423542345">+886-4-2354-2345</a>
            </div>
            <div class="small faint">從日本打會收國際電話費，但比帳戶被盜刷便宜太多。</div>
          </li>
          <li>
            <b>回不去了怎麼辦</b>——現金到便利商店 SEVEN ATM 領、聯絡辦事處請家人匯款到當地
            指定帳戶。**先確定卡真的用不了再走這步，這個很花時間。**
            ${renderOfficeContacts(info.taipeiOffice)}
          </li>
        </ol>
      </section>

      <section class="sos-card">
        <div class="sos-h">🏥 生病或受傷</div>
        <ol class="sos-steps">
          <li>
            <b>叫救護車</b>（免費）
            <div class="sos-line">消防／救護車 <a class="tel" href="tel:119">119</a></div>
            <div class="small faint">日本救護車不用錢。真的不舒服就叫，不要撐。</div>
          </li>
          <li>
            <b>不知道怎麼跟對方講</b>——句庫的「🚨 緊急」場景，日文求救句可以直接朗讀或給對方看：
            <div class="sos-line">
              <a class="btn" href="#/tools/phrases?scene=emergency">🚨 打開緊急句庫 →</a>
            </div>
          </li>
          <li>
            <b>白天不嚴重</b>——打日本旅遊熱線，24 小時多語（含中文）。他們會幫你找最近的醫院、
            告訴你要怎麼去。
            ${info.japanVisitorHotline ? `
              <div class="sos-line">
                ${escapeHtml(info.japanVisitorHotline.name)}
                <a class="tel" href="tel:${escapeHtml(tel(info.japanVisitorHotline.tel))}">${escapeHtml(info.japanVisitorHotline.tel)}</a>
              </div>
            ` : ''}
          </li>
          <li>
            <b>看完醫生要留三樣單據給旅平險理賠</b>：
            <ul class="sos-sub">
              <li>診斷證明書（要有「病名」和「日期」）</li>
              <li>醫療費用收據（含明細；領収書、不是收據小條）</li>
              <li>護照影本（證明你當時在日本）</li>
            </ul>
            <div class="small faint">回台後 30 天內向保險公司申請理賠。</div>
          </li>
        </ol>
      </section>
    </div>
  `;
}

function renderOfficeContacts(office) {
  if (!office) return '';
  const cleanA = String(office.tel || '').replace(/[^\d+]/g, '');
  const cleanE = String(office.emergency || '').replace(/[^\d+]/g, '');
  return `
    <div class="sos-line-block">
      <div class="sos-line">
        ${escapeHtml(office.name)}
        ${office.tel ? `<a class="tel" href="tel:${escapeHtml(cleanA)}">${escapeHtml(office.tel)}</a>` : ''}
      </div>
      ${office.emergency ? `
        <div class="sos-line">
          <span class="lbl">急難救助</span>
          <a class="tel" href="tel:${escapeHtml(cleanE)}">${escapeHtml(office.emergency)}</a>
        </div>` : ''}
      ${office.address ? `<div class="sos-addr small faint">${escapeHtml(office.address)}</div>` : ''}
    </div>
  `;
}
