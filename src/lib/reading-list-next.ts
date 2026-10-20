// Fork only: where to continue in a reading list, and which missing entries that skips.

export type NextItem = { issue?: { filePath?: string | null } | null, progress?: { isCompleted?: boolean } | null };

/**
 * The first unread entry in list order that has a file. `skipped` are the unread entries without a
 * file between the last read entry before it and that one, so the UI can say what is missing
 * instead of silently jumping over it. `item` is null when nothing readable is left.
 */
export function nextInList<T extends NextItem>(items: T[]): { item: T | null, index: number, skipped: T[] } {
    const unread = (i: T) => !i.progress?.isCompleted;
    if (!items.some(unread)) return { item: null, index: -1, skipped: [] };
    const index = items.findIndex(i => unread(i) && !!i.issue?.filePath);
    const end = index < 0 ? items.length : index;
    let start = end;
    while (start > 0 && unread(items[start - 1])) start--; // back to just after the last read entry
    return {
        item: index < 0 ? null : items[index],
        index,
        skipped: items.slice(start, end).filter(i => !i.issue?.filePath),
    };
}
