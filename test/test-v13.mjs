import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const PDFJS_LOCAL = '/home/claude/.npm-global/lib/node_modules/pdfjs-dist/build';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
await ctx.route('**/ajax/libs/pdf.js/**', (route) => {
  const file = route.request().url().includes('worker') ? 'pdf.worker.min.mjs' : 'pdf.min.mjs';
  route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(`${PDFJS_LOCAL}/${file}`) });
});
const page = await ctx.newPage();

// 生成一张假的"简历截图"
await page.setContent(`<html><body style="font-family:sans-serif;padding:40px"><h1>张三</h1><p>教育背景: 某大学 市场营销专业</p><p>实习经历: 运营实习生</p></body></html>`);
await page.screenshot({ path: 'test/sample-resume.png' });

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

// 未登录时传图片 → 应弹出登录
await page.setInputFiles('#resume-pdf', 'test/sample-resume.png');
await page.waitForSelector('#login-view', { state: 'visible', timeout: 5000 });
console.log('image upload login gate OK');

// 登录后自动继续识别
await page.fill('#login-email', 'test@example.com');
await page.click('#send-code-btn');
await page.waitForFunction(() => document.getElementById('login-msg').textContent.includes('已发送'), { timeout: 5000 });
await page.fill('#login-code', '123456');
await page.click('#login-btn');
await page.waitForFunction(() => document.getElementById('resume').value.includes('市场营销'), { timeout: 15000 });
console.log('image OCR auto-continue OK');

// PDF 上传仍正常
await page.click('#resume', { clickCount: 3 });
await page.keyboard.press('Control+A');
await page.keyboard.press('Delete');
await page.setInputFiles('#resume-pdf', 'test/sample-resume.pdf');
await page.waitForFunction(() => document.getElementById('resume').value.length > 50, { timeout: 20000 });
console.log('pdf upload still OK');

// 美化后的界面截图
await page.screenshot({ path: 'test/shot-7-beautified.png' });

console.log('ALL V13 TESTS PASSED');
await browser.close();
