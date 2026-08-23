import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

const [outPath, size, prompt] = process.argv.slice(2);

async function main() {
  const zai = await ZAI.create();
  const response = await zai.images.generations.create({ prompt, size });
  const b64 = response?.data?.[0]?.base64;
  if (!b64) throw new Error('Invalid response: no base64 image data');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 10000) throw new Error(`Suspiciously small image: ${buf.length} bytes`);
  fs.writeFileSync(outPath, buf);
  console.log(`OK ${outPath} ${buf.length} bytes`);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
