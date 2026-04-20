#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

// ── 1. 날짜 유틸리티 (KST 기준) ──────────────────────────────────
const KST = () => new Date(Date.now() + 9 * 3600 * 1000);
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = KST(); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const todayKo = () => { const d = KST(); return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`; };
const dayKoStr = () => ['일', '월', '화', '수', '목', '금', '토'][KST().getUTCDay()] + '요일';
const dayShort = () => ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][KST().getUTCDay()];
const dayNum = () => pad2(KST().getUTCDate());
const monthKo = () => `${KST().getUTCMonth() + 1}월`;
const monthEn = () => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][KST().getUTCMonth()];
const yearStr = () => String(KST().getUTCFullYear());

// ── 2. 구글 뉴스 수집 (RSS) ─────────────────────────────────
async function getRealtimeNews(query) {
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
        const res = await fetch(url);
        const xml = await res.text();
        return xml.split('<item>').slice(1, 11).map(it => {
            const t = it.split('<title>')[1]?.split('</title>')[0] || '';
            const l = it.split('<link>')[1]?.split('</link>')[0] || '';
            const s = it.split('<source')[1]?.split('>')[1]?.split('</source>')[0] || '뉴스';
            return `제목: ${t} / 출처: ${s} / 링크: ${l}`;
        }).join('\n');
    } catch (e) { return '뉴스 데이터 수집 실패'; }
}

// ── 3. AI 호출 (구글 Gemini 전용) ─────────────────────────────
async function callAI(system, user) {
    // GEMINI_API_KEY가 없으면 ANTHROPIC_API_KEY라도 시도합니다.
    const key = (process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
    
    if (!key) throw new Error('API 키가 없습니다. GitHub Secrets에 GEMINI_API_KEY를 등록해주세요.');

    // 구글 API 호출 주소
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }]
        })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`AI 에러: ${JSON.stringify(data.error)}`);
    
    return data.candidates[0].content.parts[0].text;
}

// JSON 파싱 시 생기는 찌꺼기(```json 등) 제거용
function cleanJSON(raw) {
    return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}

// ── 4. HTML 빌더 (기존 디자인 완벽 보존) ─────────────────────────
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

// ── 5. 섹션별 데이터 생성 ─────────────────────────────────────
async function genInsuranceNews() {
    const ctx = await getRealtimeNews('보험 신상품 상속세 시니어 달러보험');
    const res = await callAI("보험 에디터", `뉴스:\n${ctx}\n\n배열만 반환: [{"tag":"신상품","tagClass":"tag-new","title":"제목","desc":"요약","marketingTip":"팁","source":"출처","sourceType":"press","url":"링크"}]`);
    const arr = JSON.parse(cleanJSON(res));
    return { html: arr.map((item, i) => buildCard(item, i)).join(''), count: arr.length };
}

async function genHNW() {
