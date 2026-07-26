import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

// 演示模式 → 修改版简历
await page.click('#demo-btn');
await page.waitForSelector('#report', { state: 'visible' });
await page.click('#rewrite-btn');
await page.waitForSelector('#rewrite-view', { state: 'visible' });

// 内容可编辑
const editable = await page.$eval('#rewrite-content', el => el.getAttribute('contenteditable'));
if (editable !== 'true') throw new Error('content not editable');
console.log('editable OK');

// 导出 PDF:接受占位符确认框,校验打印窗口内容
page.on('dialog', d => d.accept());
const [popup] = await Promise.all([
  page.waitForEvent('popup', { timeout: 8000 }),
  page.click('#pdf-btn')
]);
await popup.waitForLoadState('domcontentloaded');
const html = await popup.content();
if (!html.includes('<h1>')) throw new Error('pdf window missing h1');
if (html.includes('待你补充')) throw new Error('notes section not stripped');
if (!html.includes('实习经历')) throw new Error('resume body missing');
console.log('pdf window content OK (notes stripped)');
await popup.screenshot({ path: 'test/shot-8-pdf.png', fullPage: true });

console.log('ALL V14 TESTS PASSED');
await browser.close();
