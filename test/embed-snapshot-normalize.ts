export function normalizeGlobalEmbedHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    element.removeAttribute('data-widget-build');
    if (element.hasAttribute('id')) element.setAttribute('id', '#id');
    const attributes = [...element.attributes].map(({ name, value }) => [name, value] as const);
    attributes.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [name] of attributes) element.removeAttribute(name);
    for (const [name, value] of attributes) element.setAttribute(name, value);
  }
  return template.innerHTML
    .replace(/\s+/g, ' ')
    .trim();
}
