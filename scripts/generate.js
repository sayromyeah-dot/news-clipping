#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// 1. 날짜 유틸리티
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

// 2. 뉴스 수집 함수
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

// 3. AI 호출 함수 (Gemini 전용)
async function callAI(system, user) {
    const key = (process.env.GEMINI_API_KEY || '').trim();
    if (!key) throw new Error('GEMINI_API_KEY가 없습니다.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }]
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`API 에러: ${JSON.stringify(data.error)}`);
    
    return data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
}

// 4. HTML 카드 빌더
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

// 5. 섹션별 생성 함수들
async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 상속세');
    const res = await callAI("보험 전문 에디터", `다음 정보를 JSON 배열(5건)로 만드세요: [{"tag":"신상품","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"마케팅포인트","source":"출처","sourceType":"press","url":"링크"}]\n\n뉴스자료:\n${ctx}`);
    try {
        const arr = JSON.parse(res);
        return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
    } catch (e) { return { html: '', count: 0 }; }
}

async function genHNW() {
    const ctx = await getRealtimeNews('자산가 투자 PB');
    const res = await callAI("투자 전략가", `JSON 배열(4건) 출력: [{"tag":"자산트렌드","tagClass":"tag-hnw","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]\n\n뉴스자료:\n${ctx}`);
    try { return JSON.parse(res).map((item, i) => buildCard(item, i, ' hnw-card')).join(''); } catch (e) { return ''; }
}

async function genTax() {
    const ctx = await getRealtimeNews('상속세 증여세 절세');
    const res = await callAI("세무 전문가", `JSON 배열(4건) 출력: [{"tag":"세무","tagClass":"tag-tax","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"official","url":"링크"}]\n\n뉴스자료:\n${ctx}`);
    try { return JSON.parse(res).map((item, i) => buildCard(item, i)).join(''); } catch (e) { return ''; }
}

async function genProducts() {
    const ctx = await getRealtimeNews('보험 신상품');
    return await callAI("리서처", `다음 뉴스를 바탕으로 <tr><td>회사</td><td>상품명</td><td>날짜</td><td>유형</td><td>특징</td></tr> HTML 행들만 생성하세요. 5줄.\n\n뉴스:\n${ctx}`);
}

async function genCategories() {
    return await callAI("에디터", "🧬헬스, 💰금융, 📊인구, 🤖AI, 🌐해외 5개 카테고리를 <div class=\"cat\">내용</div> HTML로 작성하세요.");
}

async function genCalendar() {
    const res = await callAI("매니저", '이번 주 경제 일정 JSON 배열(4건): [{"date":"MM/DD","title":"
