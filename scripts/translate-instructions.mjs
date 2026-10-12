import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const translatte = require('translatte');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EN_PATH = path.join(ROOT, 'src/instr/en.js');
const TR_PATH = path.join(ROOT, 'src/instr/tr.js');
const PROGRESS_PATH = path.join(ROOT, 'src/instr/tr-progress.json');

function polishFitnessTurkish(text) {
  if (!text) return '';
  return text
    .replace(/\bbuzağıları\b/gi, 'baldır kaslarını')
    .replace(/\bbuzağılar\b/gi, 'baldır kasları')
    .replace(/\bbuzağıyı\b/gi, 'baldırı')
    .replace(/\bbuzağı\b/gi, 'baldır')
    .replace(/\beğitir\b/gi, 'çalıştırır')
    .replace(/\beğitiyor\b/gi, 'çalıştırır')
    .replace(/\beğitirler\b/gi, 'çalıştırırlar')
    .replace(/\bbant sırası\b/gi, 'bant çekişi')
    .replace(/\bgöğüs sineği\b/gi, 'göğüs açışı')
    .replace(/\bters sinek\b/gi, 'ters açış (reverse fly)')
    .replace(/\bçömelme\b/gi, 'squat')
    .replace(/\bçömelmesi\b/gi, 'squatı')
    .replace(/\bbantlı sıra\b/gi, 'bant çekişi')
    .replace(/\bkablo sırası\b/gi, 'kablo çekişi (cable row)')
    .replace(/\bdambıl sırası\b/gi, 'dambıl çekişi (dumbbell row)')
    .replace(/\bhalter sırası\b/gi, 'halter çekişi (barbell row)')
    .replace(/\bbisepsleri\b/gi, 'pazıları (biceps)')
    .replace(/\btrisepsleri\b/gi, 'arka kol (triceps) kaslarını')
    .replace(/\btriseps\b/gi, 'arka kol (triceps)')
    .replace(/\bdelts\b/gi, 'omuz kaslarını')
    .replace(/\bquads\b/gi, 'ön bacak (quadriceps) kaslarını')
    .replace(/\bquad\b/gi, 'ön bacak')
    .replace(/\bhamstrings\b/gi, 'arka bacak (hamstring) kaslarını')
    .replace(/\bhamstringleri\b/gi, 'arka bacak kaslarını')
    .replace(/\bglutes\b/gi, 'kalça kaslarını')
    .replace(/\bpeks\b/gi, 'göğüs kaslarını')
    .replace(/\blats\b/gi, 'kanat (lat) kaslarını')
    .replace(/\saşağı doğru köpek\b/gi, 'aşağı bakan köpek')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateBatch(batch) {
  // batch is array of [id, array of steps]
  const formatted = batch.map(([id, steps]) => {
    return `<<< ${id} >>>\n` + steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  }).join('\n\n');

  try {
    const res = await translatte(formatted, { to: 'tr' });
    const blocks = res.text.split(/<<<\s*(\w+)\s*>>>/);
    const result = {};
    for (let i = 1; i < blocks.length; i += 2) {
      const id = blocks[i].trim();
      const content = blocks[i + 1].trim();
      const steps = content
        .split('\n')
        .map(l => polishFitnessTurkish(l.replace(/^\d+[\.\)]\s*/, '').trim()))
        .filter(Boolean);
      if (steps.length > 0) {
        result[id] = steps;
      }
    }

    // Check if any item in batch was missed in parse
    for (const [id, steps] of batch) {
      if (!result[id] || result[id].length === 0) {
        try {
          const singleText = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
          const singleRes = await translatte(singleText, { to: 'tr' });
          result[id] = singleRes.text
            .split('\n')
            .map(l => polishFitnessTurkish(l.replace(/^\d+[\.\)]\s*/, '').trim()))
            .filter(Boolean);
          await sleep(100);
        } catch {
          result[id] = steps; // fallback to English
        }
      }
    }
    return result;
  } catch (err) {
    console.warn('Batch translation warning, retrying items one by one...', err.message);
    const result = {};
    for (const [id, steps] of batch) {
      try {
        const singleText = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
        const singleRes = await translatte(singleText, { to: 'tr' });
        result[id] = singleRes.text
          .split('\n')
          .map(l => polishFitnessTurkish(l.replace(/^\d+[\.\)]\s*/, '').trim()))
          .filter(Boolean);
        await sleep(150);
      } catch {
        result[id] = steps;
      }
    }
    return result;
  }
}

async function main() {
  console.log('Loading instructions...');
  const en = (await import('../src/instr/en.js')).default;
  const existingTr = (await import('../src/instr/tr.js')).default;

  const total = Object.keys(en).length;
  console.log(`Total exercises in en.js: ${total}`);
  console.log(`Existing Turkish translations in tr.js: ${Object.keys(existingTr).length}`);

  let progress = { ...existingTr };
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
      Object.assign(progress, saved);
      console.log(`Loaded progress from tr-progress.json. Total translated so far: ${Object.keys(progress).length}`);
    } catch {
      console.warn('Could not read existing progress file, starting from existing tr.js');
    }
  }

  const missingEntries = Object.entries(en).filter(([id]) => !progress[id]);
  console.log(`Missing instructions to translate: ${missingEntries.length}`);

  if (missingEntries.length === 0) {
    console.log('All instructions already translated!');
    return;
  }

  const BATCH_SIZE = 10;
  let count = Object.keys(progress).length;

  for (let i = 0; i < missingEntries.length; i += BATCH_SIZE) {
    const chunk = missingEntries.slice(i, i + BATCH_SIZE);
    const translated = await translateBatch(chunk);
    Object.assign(progress, translated);
    count = Object.keys(progress).length;

    // Save progress periodically
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
    const percent = ((count / total) * 100).toFixed(1);
    console.log(`Progress: ${count}/${total} (${percent}%) instructions translated.`);

    await sleep(200);
  }

  console.log('Writing final src/instr/tr.js...');
  const finalContent = '// generated by scripts/translate-instructions.mjs\nexport default ' + JSON.stringify(progress) + ';\n';
  fs.writeFileSync(TR_PATH, finalContent, 'utf8');
  console.log('Successfully written src/instr/tr.js!');

  // Clean progress file
  fs.unlinkSync(PROGRESS_PATH);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
