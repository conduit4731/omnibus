import { prisma } from '@/lib/db';

/**
 * The admin's global "Write ComicInfo.xml" default (Settings → Metadata). Every automatic
 * EMBED_METADATA enqueue must check it; manual edits can still override it per edit.
 */
export async function comicInfoWriteEnabled(): Promise<boolean> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'metadata_write_comicinfo' } });
    return setting?.value !== 'false'; // default: write
}
