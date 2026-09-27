function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .match(/[^.!?]+[.!?]?/g) || [];
}

export function summarizeText({ text = '', maxSentences = 3 }: { text?: string; maxSentences?: number }) {
  const sentences = splitSentences(text).map(s => s.trim()).filter(Boolean);
  return sentences.slice(0, maxSentences).join(' ');
}
