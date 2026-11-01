// Preserve Chromium's PDF contents and cross references; append only opening-view settings.
// This intentionally accepts the unencrypted, classic-xref PDF produced by our slide exporter.
export function fitPresentationPdf(pdf) {
  const source = pdf.toString('latin1');
  const trailer = [...source.matchAll(/trailer\s*<<([\s\S]*?)>>\s*startxref\s+(\d+)\s*%%EOF/g)].at(-1);
  if (!trailer || source.slice(trailer.index + trailer[0].length).trim() || /\/Encrypt\b/.test(trailer[1])) {
    throw new Error('PRESENTATION_PDF_UNSUPPORTED_TRAILER');
  }
  const root = trailer[1].match(/\/Root\s+(\d+)\s+(\d+)\s+R\b/);
  if (!root) throw new Error('PRESENTATION_PDF_ROOT_MISSING');
  const object = (id, generation) => {
    const pattern = new RegExp(`(?:^|\\n)${id} ${generation} obj\\s*\\n([\\s\\S]*?)\\nendobj`, 'g');
    const found = [...source.matchAll(pattern)].at(-1);
    if (!found) throw new Error('PRESENTATION_PDF_OBJECT_MISSING');
    return found[1];
  };
  let catalog = object(root[1], root[2]);
  if (!/\/Type\s*\/Catalog\b/.test(catalog)) throw new Error('PRESENTATION_PDF_CATALOG_MISSING');
  let page = catalog.match(/\/Pages\s+(\d+)\s+(\d+)\s+R\b/);
  if (!page) throw new Error('PRESENTATION_PDF_PAGES_MISSING');
  let firstPage;
  for (let depth = 0; depth < 20; depth++) {
    const body = object(page[1], page[2]);
    if (/\/Type\s*\/Page\b/.test(body)) { firstPage = `${page[1]} ${page[2]} R`; break; }
    page = body.match(/\/Kids\s*\[\s*(\d+)\s+(\d+)\s+R\b/);
    if (!page) throw new Error('PRESENTATION_PDF_FIRST_PAGE_MISSING');
  }
  if (!firstPage) throw new Error('PRESENTATION_PDF_PAGE_TREE_INVALID');
  if (/\/OpenAction\b/.test(catalog)) {
    if (!/\/OpenAction\s*\[\s*\d+\s+\d+\s+R\s*\/Fit\s*\]/.test(catalog)) {
      throw new Error('PRESENTATION_PDF_EXISTING_OPEN_ACTION');
    }
    catalog = catalog.replace(/\/OpenAction\s*\[\s*\d+\s+\d+\s+R\s*\/Fit\s*\]/, '');
  }
  catalog = catalog.replace(/\/PageLayout\s*\/\w+\b/g, '');
  const end = catalog.lastIndexOf('>>');
  if (end < 0) throw new Error('PRESENTATION_PDF_CATALOG_INVALID');
  catalog = `${catalog.slice(0, end)}\n/OpenAction [${firstPage} /Fit]\n/PageLayout /SinglePage\n${catalog.slice(end)}`;
  const prefix = Buffer.from('\n% SafeHandoff presentation opening view\n', 'ascii');
  const objectOffset = pdf.length + prefix.length;
  const updatedObject = Buffer.from(`${root[1]} ${root[2]} obj\n${catalog}\nendobj\n`, 'latin1');
  const xrefOffset = objectOffset + updatedObject.length;
  const trailerBody = trailer[1].replace(/\/Prev\s+\d+\b/g, '');
  const xref = Buffer.from(`xref\n${root[1]} 1\n${String(objectOffset).padStart(10, '0')} ${String(root[2]).padStart(5, '0')} n \n` +
    `trailer\n<<${trailerBody}\n/Prev ${trailer[2]}>>\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1');
  return Buffer.concat([pdf, prefix, updatedObject, xref]);
}
