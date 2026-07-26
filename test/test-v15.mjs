import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

await page.click('#demo-btn');
await page.waitForSelector('#report', { state: 'visible' });
await page.click('#rewrite-btn');
await page.waitForSelector('#rewrite-view', { state: 'visible' });
page.on('dialog', d => d.accept());

// 把内容撑长,测试一页纸的自动压缩
await page.evaluate(() => {
  const el = document.getElementById('rewrite-content');
  let extra = '';
  for (let i = 0; i < 5; i++) {
    extra += `\n## 项目经历 ${i + 1}\n**某项目 · 负责人**(2025)\n- 主导项目从 0 到 1 落地,覆盖用户 [X] 人,转化率提升 [X]%\n- 搭建数据看板,监控 [X] 项核心指标,周报复盘迭代\n- 协调 [X] 个跨部门团队,保障项目按期交付\n`;
  }
  el.textContent = el.textContent.replace('\n---', extra + '\n---');
});

// 一页纸导出:验证自动缩放到一页
const [popup1] = await Promise.all([
  page.waitForEvent('popup', { timeout: 8000 }),
  page.click('#pdf-one-btn')
]);
await popup1.waitForLoadState('load');
await popup1.waitForFunction(() => window.__fitted !== undefined, { timeout: 8000 });
const fitted = await popup1.evaluate(() => ({
  fs: window.__fitted,
  h: document.documentElement.scrollHeight
}));
console.log('one-page fitted font:', fitted.fs, 'height:', fitted.h);
if (fitted.h > 1125) throw new Error('content not fitted to one page');
const html1 = await popup1.content();
if (html1.includes('待你补充')) throw new Error('notes not stripped');
await popup1.screenshot({ path: 'test/shot-9-onepage.png', fullPage: true });
await popup1.close();

// 不限页数导出仍正常
const [popup2] = await Promise.all([
  page.waitForEvent('popup', { timeout: 8000 }),
  page.click('#pdf-btn')
]);
await popup2.waitForLoadState('domcontentloaded');
const html2 = await popup2.content();
if (!html2.includes('<h1>')) throw new Error('multi-page export broken');
console.log('multi-page export OK');

console.log('ALL V15 TESTS PASSED');
await browser.close();
