import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'test/shot-1-input.png' });

// 演示报告
await page.click('#demo-btn');
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-2-report.png', fullPage: true });

// 走一遍真实提交流程(mock 后端)
await page.click('#back-btn');
await page.fill('#resume', '教育背景:某大学 市场营销专业 2022-2026\n实习经历:某公司 运营实习生\n负责产品的日常运营工作。将转化率提升至 5%。\n技能:熟悉各类办公软件。');
await page.fill('#jd', '岗位:AI 产品经理\n要求:有 Prompt 设计经验,了解 RAG 与 Agent,具备用户调研能力。');
await page.click('#analyze-btn');
await page.waitForSelector('#report', { state: 'visible', timeout: 10000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-3-mock-analyze.png', fullPage: true });

console.log('screenshots done');
await browser.close();
