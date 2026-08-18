const SVG_NS = 'http://www.w3.org/2000/svg';

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

export function svgFromContainer(container: HTMLElement | null): string | null {
  const svg = container?.querySelector('svg');
  return svg ? serializeSvg(svg) : null;
}

export function downloadSvg(filename: string, svgMarkup: string) {
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copySvg(svgMarkup: string) {
  await navigator.clipboard.writeText(svgMarkup);
}
