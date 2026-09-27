function sanitize(str: string): string {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-');
}

export function suggestBibKey({ title = '', authors = '' }: { title?: string; authors?: string }) {
  const primaryAuthor = (authors.split(/,|and/)[0] || 'anon').trim().split(/\s+/).pop();
  const core = sanitize(title).split('-').slice(0, 3).join('');
  const yearMatch = title.match(/\b(19|20|21)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear();
  return `${primaryAuthor || 'anon'}${core ? ('-' + core) : ''}-${year}`;
}
