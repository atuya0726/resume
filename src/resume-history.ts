import type { Profile, TimelineItem } from './profile.ts';
import { parseMonth } from './validation.ts';

export type CareerRow = TimelineItem & { path: string };

export function careerRows(profile: Profile): CareerRow[] {
  const ranges = profile.career.map((job) => job.period.trim().split(/\s*[〜～~–—]\s*/));
  const transfers = new Map<number, number>();
  // Legacy content already describes acquisitions in prose. Use only an explicit,
  // dated employer change that matches one outgoing and one incoming employment.
  const narrative = `${profile.careerOverview ?? ''}\n${profile.summary}`;
  for (const sentence of narrative.split(/[。！？\n]/)) {
    const dates = [...sentence.matchAll(/\d{4}年\s*\d{1,2}月/g)];
    dates.forEach((date, position) => {
      const clause = sentence.slice(date.index! + date[0].length, dates[position + 1]?.index);
      if (!/買収/.test(clause) || !/雇用先[^。]*変更/.test(clause)) return;
      const month = parseMonth(date[0]);
      if (month === null) return;
      const incoming = ranges.flatMap((range, index) => range.length === 2 && parseMonth(range[0]) === month ? [index] : []);
      const outgoing = ranges.flatMap((range, index) => range.length === 2 && parseMonth(range[1]) === month - 1 ? [index] : []);
      if (incoming.length === 1 && outgoing.length === 1 && incoming[0] !== outgoing[0]) transfers.set(outgoing[0], incoming[0]);
    });
  }
  const incoming = new Set(transfers.values());
  return profile.career.flatMap((job, index) => {
    const path = `career.${index}`;
    const range = ranges[index];
    const role = job.role ? `（${job.role}）` : '';
    if (range.length === 2 && parseMonth(range[0]) !== null && (parseMonth(range[1]) !== null || range[1] === '現在')) {
      const rows = [{ path, period: range[0], description: incoming.has(index)
        ? `会社買収に伴い${job.company ? ` ${job.company} へ` : ''}雇用先変更${role}`
        : `${job.company} 入社${role}` }];
      if (!transfers.has(index)) rows.push({ path, period: range[1] === '現在' ? '' : range[1], description: range[1] === '現在' ? '現在に至る' : `${job.company} 退職` });
      return rows;
    }
    // Preserve incomplete or unrecognized periods without inventing events.
    return [{ path, period: job.period, description: `${job.company}${role}` }];
  });
}
