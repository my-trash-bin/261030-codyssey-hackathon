// @ts-check
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const html = new URL('../docs/presentation/SafeHandoff_발표자료_통합.html', import.meta.url);
const output = fileURLToPath(new URL('../docs/presentation/SafeHandoff_발표자료_통합.pdf', import.meta.url));

async function fontStyles() {
  const cssURL = import.meta.resolve('@fontsource-variable/noto-sans-kr/index.css');
  let css = await readFile(new URL(cssURL), 'utf8');
  const paths = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map(match => match[1]))];
  const embedded = await Promise.all(paths.map(async path => ({ path,
    data: (await readFile(new URL(path, cssURL))).toString('base64') })));
  for (const { path, data } of embedded) css = css.replaceAll(`url(${path})`, `url(data:font/woff2;base64,${data})`);
  return css + '\n.slide-scope, .slide-scope * { font-family: "Noto Sans KR Variable", sans-serif !important; }';
}

async function main() {
  // No font download, network service, private config or hard-coded local browser path at build time.
  await readFile(html);
  const font = await fontStyles();
  const browser = await chromium.launch({ headless: true });
  const temporary = `${output}.${randomUUID()}.tmp.pdf`;
  try {
    const page = await browser.newPage({ viewport: { width: 1320, height: 800 }, serviceWorkers: 'block' });
    await page.route('**/*', route => {
      const protocol = new URL(route.request().url()).protocol;
      return ['file:', 'data:', 'blob:'].includes(protocol) ? route.continue() : route.abort();
    });
    await page.goto(html.href, { waitUntil: 'load' });
    await page.addStyleTag({ content: font });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(async () => {
      await document.fonts.load('400 16px "Noto Sans KR Variable"', '한글 발표자료');
      await document.fonts.load('900 16px "Noto Sans KR Variable"', '한글 발표자료');
      await document.fonts.ready;
    });
    const slides = await page.locator('.slide-scope').count();
    const images = await page.locator('img').evaluateAll(elements => elements.map(image => ({
      source: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0,
    })));
    if (slides !== 12 || images.some(image => !image.loaded)) throw new Error('PRESENTATION_SLIDE_OR_IMAGE_MISSING');
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length;
    if (pages !== slides) throw new Error('PRESENTATION_PAGE_COUNT_MISMATCH');
    await writeFile(temporary, pdf, { flag: 'wx' });
    await rename(temporary, output);
    console.log(JSON.stringify({ html: fileURLToPath(html), pdf: output, slides, pages,
      images: images.length, bytes: pdf.length, network: 'blocked' }));
  } finally {
    await rm(temporary, { force: true });
    await browser.close();
  }
}
main().catch(error => {
  console.error('PRESENTATION_BUILD_FAILED:', error.message);
  console.error('준비: mise run setup-presentation; Linux 시스템 라이브러리가 없으면 mise run setup-presentation-system');
  process.exitCode = 1;
});
