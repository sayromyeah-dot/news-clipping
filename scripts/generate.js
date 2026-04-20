'use strict';

const fs = require('fs');
const path = require('path');

const KST = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2 = (n) => String(n).padStart(2, '0');

const todayStr = () => {
    const d = KST();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};
const todayKo = () => {
    const d = KST();
    return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};
const dayKoStr = () => ['일', '월', '화', '수', '목', '금', '토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][KST().getUTCDay()];
const dayNum = () => pad2(KST().getUTCDate());
const monthKo = () => `${KST().getUTCMonth() + 1}월`;
const monthEn = () => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][KST().getUTCMonth()];
const yearStr = () => String(KST().getUTCFullYear());

async function getRealtimeNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url);
        if (!res.ok) return '데이터 없음';
        const xml = await res.text();
        return xml.split('<item>').slice(1, 11).map(it => {
            const title = it.split('<title>')[1]?.split('</title>')[0] || '';
            const link = it.split('<link>')[1]?.split('</link>')[0] || '';
            const source = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
            return `제목: ${title} / 출처: ${source} / 링크: ${link}`;
        }).join('\n');
    } catch (e) { return '수집 에러'; }
}

async function callAI(system, user) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) throw new Error('GEMINI_API_KEY가 없습니다.');

    // 최신 표준 v1 경로와 모델명 명시
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: "user",
                parts: [{ text: `System context: ${system}\n\nUser request: ${user}` }]
            }]
        })
    });

    const data = await res.json();
    if (!res.ok) {
        const msg = data.error ? data.error.message : JSON.stringify(data);
        throw new Error(`API 에러: ${res.status} - ${msg}`);
    }
    
    if (!data.candidates || !data.candidates[0].content) {
        throw new Error('AI 응답이 비어있습니다.');
    }
    
    return data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
}

function buildCard(item, index, extraClass = '') {
    const num = String(index + 1).padStart(2, '0');
    const bMap = { official: 'badge-official', press: 'badge-press', research: 'badge-research' };
    const lMap = { official: '공식발표', press: '언론보도', research: '리서치' };
    return `
    <a class="news-card${extraClass}" href="${encodeURI(item.url || '#')}" target="_blank">
        <div class="nc-num">${num}</div>
        <div>
            <div class="nc-tags"><span class="nc-tag ${item.tagClass || 'tag-mkt'}">${item.tag || '뉴스'}</span></div>
            <div class="nc-title">${item.title || ''}</div>
            <div class="nc-desc">${item.desc || ''}</div>
            ${item.marketingTip ? `<div class="nc-mkt-tip">${item.marketingTip}</div>` : ''}
            <div class="nc-footer">
                <span class="nc-src">${item.source || ''}<span class="nc-src-badge ${bMap[item.sourceType] || 'badge-press'}">${lMap[item.sourceType] || '언론보도'}</span></span>
                <span class="nc-link">원문 보기 →</span>
            </div>
        </div>
    </a>`;
}

async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 상속세');
    const res = await callAI("Insurance News Editor", `Output JSON array(5 items): [{"tag":"신상품","tagClass":"tag-new","title":"string","desc":"string","marketingTip":"string","source":"string","sourceType":"press","url":"string"}]\nContext:\n${ctx}`);
    try {
        const arr = JSON.parse(res);
        return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
    } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
    const ctx = await getRealtimeNews('Wealth Management Trends');
    const res = await callAI("HNW Researcher", `Output JSON array(4 items): [{"tag":"자산트렌드","tagClass":"tag-hnw","title":"string","desc":"string","marketingTip":"string","source":"string","sourceType":"press","url":"string"}]\nContext:\n${ctx}`);
    try { return JSON.parse(res).map((item, i) => buildCard(item, i, ' hnw-card')).join(''); } catch (e) { return ''; }
}

async function genTax() {
    const ctx = await getRealtimeNews('Tax savings inheritance');
    const res = await callAI("Tax Expert", `Output JSON array(4 items): [{"tag":"세무","tagClass":"tag-tax","title":"string","desc":"string","marketingTip":"string","source":"string","sourceType":"official","url":"string"}]\nContext:\n${ctx}`);
    try { return JSON.parse(res).map((item, i) => buildCard(item, i)).join(''); } catch (e) { return ''; }
}

async function genProducts() {
    const ctx = await getRealtimeNews('New Insurance Products');
    return await callAI("Product Analyst", `Generate 5 rows of <tr><td>Company</td><td>Product</td><td>Date</td><td>Type</td><td>Feature</td></tr> HTML only based on:\n${ctx}`);
}

async function genCategories() {
    return await callAI("Editor", "Generate 5 categories in <div class=\"cat\">Icon Name: Trend</div> HTML format (Health, Finance, Population, AI, Global).");
}

async function genCalendar() {
    const res = await callAI("Finance Manager", 'Economic calendar JSON array(4 items): [{"date":"MM/DD","title":"string"}]');
    try { return JSON.parse(res).map(it => `<div class="cal-row"><div class="cal-dt">${it.date}</div><div class="cal-t">${it.title}</div></div>`).join(''); } catch (e) { return ''; }
}

async function main() {
    const date = todayStr(); const ko = todayKo();
    console.log(`🚀 AIA 뉴스레터 생성 시작: ${ko}`);
    const tplPath = path.join(__dirname, '..', 'template.html');
    if (!fs.existsSync(tplPath)) throw new Error('template.html not found');
    let html = fs.readFileSync(tplPath, 'utf-8');
    
    const [news, hnw, tax, products, cats, cal] = await Promise.all([
        genInsuranceNews(), genHNW(), genTax(), genProducts(), genCategories(), genCalendar()
    ]);

    html = html
        .replace(/\{\{DATE_KO\}\}/g, ko).replace(/\{\{DATE_ISO\}\}/g, date)
        .replace(/\{\{DAY_KO\}\}/g, dayKoStr()).replace(/\{\{DAY_SHORT\}\}/g, dayShort())
        .replace(/\{\{DAY_NUM\}\}/g, dayNum()).replace(/\{\{MONTH_KO\}\}/g, monthKo())
        .replace(/\{\{MONTH_EN\}\}/g, monthEn()).replace(/\{\{YEAR\}\}/g, yearStr())
        .replace(/\{\{USD_VAL\}\}/g, "1,471원")
        .replace(/\{\{SUMMARY\}\}/g, "시장 주요 뉴스를 전해드립니다.")
        .replace(/\{\{NEWS_COUNT\}\}/g, String(news.count))
        .replace(/\{\{NEWS_ITEMS\}\}/g, news.html)
        .replace(/\{\{HNW_ITEMS\}\}/g, hnw)
        .replace(/\{\{TAX_ITEMS\}\}/g, tax)
        .replace(/\{\{PRODUCT_ROWS\}\}/g, products)
        .replace(/\{\{CAT_BLOCKS\}\}/g, cats)
        .replace(/\{\{CAL_ITEMS\}\}/g, cal);

    const outDir = path.join(__dirname, '..', 'newsletters');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${date}.html`), html);
    fs.writeFileSync(path.join(outDir, 'latest.html'), html);
    console.log(`🎉 생성 완료`);
}

main().catch(err => {
    console.error('❌ 에러:', err);
    process.exit(1);
});
