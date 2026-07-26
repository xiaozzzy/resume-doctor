// v1.6 海报功能测试 + 全量回归(本地 mock server 需先启动: node test/server.js)
import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3000';
const PDFJS_LOCAL = '/home/claude/.npm-global/lib/node_modules/pdfjs-dist';

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// cdnjs 在沙盒不可达 → 拦截并回本地 pdfjs-dist
await ctx.route('**/cdnjs.cloudflare.com/**', async (route) => {
  const url = route.request().url();
  const file = url.includes('pdf.worker') ? 'pdf.worker.min.mjs' : 'pdf.min.mjs';
  const body = fs.readFileSync(path.join(PDFJS_LOCAL, 'build', file));
  await route.fulfill({ status: 200, contentType: 'text/javascript', body });
});

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

console.log('— 1. 页面加载 + 统计条 —');
await page.goto(BASE);
await page.waitForTimeout(600);
check('标题渲染', (await page.title()).includes('简历医生'));
const stats = await page.textContent('#stats-line');
check('统计条显示 mock 数据', stats.includes('12') && stats.includes('34'), `got: ${stats}`);

console.log('— 2. PDF 上传解析(pdf.js 本地拦截) —');
// 用 pdf-lib 生成含文字的测试 PDF
const { PDFDocument, StandardFonts } = await import('/home/claude/.npm-global/lib/node_modules/pdf-lib/dist/pdf-lib.esm.js');
const doc = await PDFDocument.create();
const p1 = doc.addPage([595, 842]);
const font = await doc.embedFont(StandardFonts.Helvetica);
p1.drawText('Zhang San - Product Manager Resume', { x: 50, y: 780, size: 16, font });
p1.drawText('Experience: Grew DAU from 12k to 25k in 3 months at XX Tech.', { x: 50, y: 740, size: 12, font });
p1.drawText('Education: XX University, Marketing, 2019-2023. Skills: SQL, Excel.', { x: 50, y: 710, size: 12, font });
const pdfPath = path.join(__dirname, 'sample-resume.pdf');
fs.writeFileSync(pdfPath, await doc.save());
await page.setInputFiles('#resume-pdf', pdfPath);
await page.waitForTimeout(2500);
const resumeVal = await page.inputValue('#resume');
check('PDF 文本填入 textarea', resumeVal.includes('Zhang San') && resumeVal.includes('DAU'), `len=${resumeVal.length}`);

console.log('— 3. 开始诊断 → 登录门 → mock 登录 —');
// 补足 50 字下限
if (resumeVal.length < 60) await page.fill('#resume', resumeVal + '\n熟悉办公软件,工作认真负责,有责任心,负责公司产品的日常运营工作。');
await page.click('#analyze-btn');
await page.waitForTimeout(300);
check('未登录时弹出登录页', await page.isVisible('#login-view'));
await page.fill('#login-email', 'tester@example.com');
await page.click('#send-code-btn');
await page.waitForTimeout(300);
await page.fill('#login-code', '123456');
await page.click('#login-btn');
await page.waitForSelector('#report', { state: 'visible', timeout: 8000 });
check('登录后自动继续诊断并出报告', true);
const score = await page.textContent('#score');
check('报告分数为 mock 值 72', score.trim() === '72', `got: ${score}`);
const authStatus = await page.textContent('#auth-status');
check('登录态显示邮箱', authStatus.includes('tester@example.com'));
const dimCount = await page.locator('#dimensions .dim-row').count();
check('五维评分渲染 5 行', dimCount === 5, `got: ${dimCount}`);

console.log('— 4. 生成诊断海报 —');
check('报告页有海报按钮', await page.isVisible('#poster-btn'));
await page.click('#poster-btn');
await page.waitForSelector('#poster-modal', { state: 'visible', timeout: 8000 });
check('海报弹窗打开', true);
const imgSrc = await page.getAttribute('#poster-img', 'src');
check('海报为 dataURL 且体积正常', imgSrc && imgSrc.startsWith('data:image/png') && imgSrc.length > 50000, `len=${imgSrc ? imgSrc.length : 0}`);
const imgDim = await page.evaluate(() => {
  const i = document.getElementById('poster-img');
  return { w: i.naturalWidth, h: i.naturalHeight };
});
check('海报尺寸 1500×2500(@2x)', imgDim.w === 1500 && imgDim.h === 2500, JSON.stringify(imgDim));
// 存海报 PNG 供人工检查
fs.writeFileSync(path.join(__dirname, 'poster-sample.png'), Buffer.from(imgSrc.split(',')[1], 'base64'));
// 弹窗截图
await page.screenshot({ path: path.join(__dirname, 'shot-poster-modal.png') });
await page.click('#poster-close');
await page.waitForTimeout(200);
check('关闭按钮生效', !(await page.isVisible('#poster-modal')));

console.log('— 5. 一键改写 → 编辑 → 导出 —');
await page.click('#rewrite-btn');
await page.waitForSelector('#rewrite-view', { state: 'visible', timeout: 8000 });
const rwText = await page.textContent('#rewrite-content');
check('改写结果渲染(mock 张三)', rwText.includes('张三') && rwText.includes('[X]'));
const editable = await page.getAttribute('#rewrite-content', 'contenteditable');
check('改写内容可编辑', editable === 'true');

// 一页纸导出:处理 [X] confirm + popup
page.once('dialog', (d) => d.accept());
const [popup] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 8000 }),
  page.click('#pdf-one-btn'),
]);
await popup.waitForFunction(() => window.__fitted !== undefined, null, { timeout: 8000 }).catch(() => {});
const fitted = await popup.evaluate(() => window.__fitted).catch(() => undefined);
check('一页纸导出弹窗 + 自适应字号', typeof fitted === 'number' && fitted <= 13 && fitted >= 8.5, `fitted=${fitted}`);
const popupHtml = await popup.evaluate(() => document.body.innerHTML).catch(() => '');
check('导出内容去掉"待你补充"区', !popupHtml.includes('待你补充') && popupHtml.includes('张三'));
await popup.close();

// 不限页数导出
page.once('dialog', (d) => d.accept());
const [popup2] = await Promise.all([
  ctx.waitForEvent('page', { timeout: 8000 }),
  page.click('#pdf-btn'),
]);
await popup2.waitForTimeout(600);
const p2html = await popup2.evaluate(() => document.body.innerHTML).catch(() => '');
check('不限页数导出弹窗有内容', p2html.includes('张三'));
await popup2.close();

console.log('— 6. 返回报告 → 演示模式海报回归 —');
await page.click('#rewrite-back-btn');
await page.waitForTimeout(200);
check('返回报告页', await page.isVisible('#report'));
await page.click('#back-btn');
await page.waitForTimeout(200);
check('返回输入页', await page.isVisible('#input-panel'));
await page.click('#demo-btn');
await page.waitForTimeout(300);
check('演示报告打开(58 分)', (await page.textContent('#score')).trim() === '58');
await page.click('#poster-btn');
await page.waitForSelector('#poster-modal', { state: 'visible', timeout: 8000 });
const demoSrc = await page.getAttribute('#poster-img', 'src');
check('演示模式也能生成海报', demoSrc && demoSrc.length > 50000);
// 点击遮罩关闭
await page.mouse.click(30, 300);
await page.waitForTimeout(200);
check('点遮罩关闭弹窗', !(await page.isVisible('#poster-modal')));

console.log('— 7. 图片上传登录门(已登录直接走 OCR mock) —');
// 生成一张测试图片(sharp)
const sharp = (await import('/home/claude/.npm-global/lib/node_modules/sharp/lib/index.js')).default;
const imgPath = path.join(__dirname, 'sample-resume.png');
await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toFile(imgPath);
await page.click('#back-btn').catch(() => {});
await page.waitForTimeout(200);
if (!(await page.isVisible('#input-panel'))) { await page.goto(BASE); await page.waitForTimeout(500); }
await page.setInputFiles('#resume-pdf', imgPath);
await page.waitForTimeout(1500);
const ocrVal = await page.inputValue('#resume');
check('图片 OCR mock 文本填入', ocrVal.includes('张三'), `got: ${ocrVal.slice(0, 40)}`);

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
await browser.close();
process.exit(failed ? 1 : 0);
