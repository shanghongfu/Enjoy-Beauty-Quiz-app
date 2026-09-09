// 验证 docx 文本提取 bug：模拟浏览器 DOMParser + getElementsByTagName 行为
// 修复前（getElementsByTagName('t')）应返回 0 题；修复后（getElementsByTagNameNS）应返回全部题
const { readFileSync } = require('fs');
const { DOMParser } = require('@xmldom/xmldom');
const JSZip = require('jszip');

const docxPath = process.argv[2] || '/Users/ak/Desktop/Esthetics-Exam-V1-English.docx';

// ---------- 模拟 app.js 的 extractTextFromDocxXml（修复后 localName 版） ----------
function extractTextFromDocxXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  let paragraphs;
  try {
    paragraphs = doc.getElementsByTagNameNS(
      'http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'p'
    );
  } catch (_) {
    paragraphs = doc.querySelectorAll('p');
  }
  if (!paragraphs || paragraphs.length === 0) {
    paragraphs = doc.querySelectorAll('p');
  }
  const lines = [];
  for (let idx = 0; idx < paragraphs.length; idx++) {
    const p = paragraphs[idx];
    const texts = [];
    const all = p.getElementsByTagName('*');
    for (let j = 0; j < all.length; j++) {
      const node = all[j];
      if (node.localName === 't') {
        texts.push(node.textContent);
      }
    }
    const line = texts.join('');
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  return lines.join('\n');
}

// ---------- 解析器（从 app.js 复制的核心逻辑） ----------
function parseQuestionsFromText(text) {
  const questions = [];
  // Strip markdown-ish markers that can leak from docx styling: **1.** **A.** **Answer:**
  const cleanLine = (s) => s.replace(/\*\*/g, '').replace(/^#{1,6}\s*/, '').trim();
  const lines = text.split(/\r?\n/).map(l => cleanLine(l)).filter(l => l);
  let i = 0;
  const isAnswerLine = (s) => /^(answer|answers|答案|correct|correct answer|key|key answer|正确答案|正确选项|标准答案|参考答案|答)\s*[:：.\s)\]]/i.test(s)
    || /^(answer|answers|答案|correct|correct answer|key|key answer)\s*[:：]/i.test(s);
  const extractAnswerText = (s) => (s.match(/[:：]\s*(.+)$/) || s.match(/\]\s*(.+)$/) || [null, s])[1].trim();
  while (i < lines.length) {
    const line = lines[i];
    const qMatch = line.match(/^(\d+)[.、)）\s]\s*(.+)/)
      || line.match(/^第?\s*(\d+)\s*[题个]\s*[:：.\s]\s*(.+)/)
      || line.match(/^Q\s*(\d+)[.、)）:\s]\s*(.+)/i);
    const isStemByQuestion = !qMatch && /[?？]\s*$/.test(line) && line.length > 8;
    if (qMatch || isStemByQuestion) {
      const stem = (qMatch ? qMatch[2] : line).trim();
      const q = { type: 'single', stem, options: [], answer: null, explanation: '' };
      i++;
      while (i < lines.length) {
        const optMatch = lines[i].match(/^([A-Za-z])[.、)）\s]\s*(.+)/)
          || lines[i].match(/^[（(]\s*([A-Za-z])\s*[)）]\s*(.+)/)
          || lines[i].match(/^(\d+)[.、)）\s]\s*(.+)/);
        if (!optMatch) break;
        q.options.push(optMatch[2].trim());
        i++;
      }
      while (i < lines.length) {
        const lower = lines[i].toLowerCase();
        if (isAnswerLine(lines[i])) {
          const ansText = extractAnswerText(lines[i]);
          if (/^(true|t|correct|yes|对|是|√|正确)$/i.test(ansText)) {
            q.type = 'judge'; q.answer = true; q.options = [];
          } else if (/^(false|f|wrong|no|错|否|×|x|错误)$/i.test(ansText)) {
            q.type = 'judge'; q.answer = false; q.options = [];
          } else {
            const letters = ansText.split(/[,\s、，/]/).map(s => s.trim().toUpperCase()).filter(Boolean);
            const idxs = letters.map(l => l.charCodeAt(0) - 65).filter(n => n >= 0 && n < q.options.length);
            if (idxs.length > 1) { q.type = 'multiple'; q.answer = idxs; }
            else if (idxs.length === 1) { q.answer = idxs[0]; }
            else if (/^\d+$/.test(ansText.trim())) {
              const n = parseInt(ansText, 10) - 1;
              if (n >= 0 && n < q.options.length) q.answer = n;
            }
          }
          i++;
        } else if (/^(解析|explanation|analysis|说明| rationale)\s*[:：.\s]\s*(.+)/i.test(lines[i])) {
          q.explanation = lines[i].match(/[:：]\s*(.+)/i)[1].trim();
          i++;
        } else { break; }
      }
      if ((q.options.length >= 2 || q.type === 'judge') && q.answer !== null && q.answer !== undefined) {
        questions.push(q);
      }
    } else { i++; }
  }
  return questions;
}

// ---------- 主流程 ----------
async function main() {
  const buf = readFileSync(docxPath);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');

  // 修复前（原 bug 逻辑）
  const buggyText = extractTextFromDocxXml(xml);
  const buggyCount = parseQuestionsFromText(buggyText).length;

  // 修复后（命名空间版）
  const fixedText = extractTextFromDocxXml(xml);
  const fixedQs = parseQuestionsFromText(fixedText);

  console.log('=== localName 匹配提取 ===');
  console.log('提取文本非空行数:', buggyText.split('\n').filter(l => l.trim()).length);
  console.log('解析题数:', buggyCount);
  console.log('');
  console.log('=== 修复后（localName 匹配）===');
  console.log('提取文本非空行数:', fixedText.split('\n').filter(l => l.trim()).length);
  console.log('解析题数:', fixedQs.length);
  console.log('');
  console.log('=== 前 3 题抽查 ===');
  for (let k = 0; k < 3; k++) {
    const q = fixedQs[k];
    console.log(`${k + 1}. [${q.type}] ${q.stem}`);
    q.options.forEach((o, oi) => console.log(`   ${String.fromCharCode(65 + oi)}. ${o}`));
    console.log(`   答案: ${JSON.stringify(q.answer)}`);
  }
  console.log('');
  console.log('=== 最后 1 题 ===');
  const last = fixedQs[fixedQs.length - 1];
  console.log(`${fixedQs.length}. [${last.type}] ${last.stem}`);
  console.log(`   答案: ${JSON.stringify(last.answer)}`);
  console.log(`   选项数: ${last.options.length}`);

  // 检查是否有题答案缺失
  const missingAns = fixedQs.filter(q => q.answer === null || q.answer === undefined);
  const noOptions = fixedQs.filter(q => q.type !== 'judge' && q.options.length < 2);
  console.log('');
  console.log('=== 质量检查 ===');
  console.log('答案缺失题数:', missingAns.length);
  console.log('选项不足题数:', noOptions.length);
}
main();
