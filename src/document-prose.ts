export type ProseBlock = { kind: 'paragraph' | 'heading'; text: string } | { kind: 'list'; items: string[] };

// Formatting affects presentation only; the stored text remains unchanged.
export function proseBlocks(text: string, lineItems = false): ProseBlock[] {
  const groups = text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter(Boolean);
  const blocks: ProseBlock[] = [];
  groups.forEach((group, index) => {
    const lines = group.split('\n').map((line) => line.trim()).filter(Boolean);
    const heading = lines[0]?.match(/^(?:#{1,4}\s+(.+)|【(.+)】)$/);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] ?? heading[2] });
      lines.shift();
    } else if (lines.length === 1 && index < groups.length - 1 && lines[0].length <= 40 && !/[。.!?！？：:]$/.test(lines[0]) && !/^[-・•]\s*/.test(lines[0])) {
      blocks.push({ kind: 'heading', text: lines.shift()! });
    }
    if (!lines.length) return;
    if (lineItems && lines.length > 1 && lines.every((line) => line.length <= 100 && !/[。！？]$/.test(line))) {
      blocks.push({ kind: 'list', items: lines.map((line) => line.replace(/^[-・•]\s*/, '')) });
      return;
    }
    let paragraph: string[] = [];
    let items: string[] = [];
    const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join('\n') }); paragraph = []; };
    const flushList = () => { if (items.length) blocks.push({ kind: 'list', items }); items = []; };
    for (const line of lines) {
      const bullet = line.match(/^(?:[-•]\s+|・\s*)(.+)$/);
      if (bullet) { flushParagraph(); items.push(bullet[1]); }
      else { flushList(); paragraph.push(line); }
    }
    flushParagraph(); flushList();
  });
  return blocks;
}
