import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

import { readFileSync } from 'node:fs';

const PDFJS_LOCAL = '/home/claude/.npm-global/lib/node_modules/pdfjs-dist/build';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
// 沙盒访问不了 cdnjs,拦截请求改用本地 pdfjs 副本(线上无此问题)
await ctx.route('**/ajax/libs/pdf.js/**', (route) => {
  const url = route.request().url();
  const file = url.includes('worker') ? 'pdf.worker.min.mjs' : 'pdf.min.mjs';
  route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    body: readFileSync(`${PDFJS_LOCAL}/${file}`)
  });
});
const page = await ctx.newPage();

// 1. 生成一份样例简历 PDF
await page.setContent(`<html><body style="font-family:sans-serif;padding:40px;line-height:1.8">
<h1>张三</h1>
<p>教育背景: 某大学 市场营销专业 2022-2026</p>
<p>实习经历: 某互联网公司 运营实习生 2025.3-2025.6</p>
<p>负责公众号的日常内容运营,提升了粉丝数量和阅读量。</p>
<p>参与策划校园推广活动,活动效果良好。</p>
<p>技能: 熟练使用 Office 办公软件,具备良好的沟通能力。</p>
</body></html>`);
await page.pdf({ path: 'test/sample-resume.pdf' });
console.log('sample pdf created');

// 2. 打开应用,上传 PDF
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.setInputFiles('#resume-pdf', 'test/sample-resume.pdf');
await page.waitForFunction(() => document.getElementById('resume').value.length > 50, { timeout: 20000 });
const extracted = await page.$eval('#resume', el => el.value);
console.log('PDF extracted chars:', extracted.length);
if (!extracted.includes('市场营销')) throw new Error('PDF text extraction failed');
await page.screenshot({ path: 'test/shot-4-pdf-upload.png' });

// 3. 填 JD → 诊断(mock)→ 一键改简历(mock)
await page.fill('#jd', '岗位: AI 产品运营实习生。要求: 会用数据分析工具,有 A/B 测试意识。');
await page.click('#analyze-btn');
await page.waitForSelector('#report', { state: 'visible', timeout: 10000 });
await page.click('#rewrite-btn');
await page.waitForSelector('#rewrite-view', { state: 'visible', timeout: 10000 });
await page.waitForTimeout(500);
const rw = await page.$eval('#rewrite-content', el => el.textContent);
if (!rw.includes('[X]')) throw new Error('rewrite content missing');
await page.screenshot({ path: 'test/shot-5-rewrite.png', fullPage: true });

// 4. 演示模式也走一遍改简历
await page.click('#rewrite-back-btn');
await page.click('#back-btn');
await page.click('#demo-btn');
await page.click('#rewrite-btn');
await page.waitForSelector('#rewrite-view', { state: 'visible', timeout: 5000 });

console.log('ALL TESTS PASSED');
await browser.close();
