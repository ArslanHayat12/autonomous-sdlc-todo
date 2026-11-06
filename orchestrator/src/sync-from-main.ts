import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Copy select paths from the main checkout into the worktree when present and content differs.
 * Does not modify the main repo; brings uncommitted test fixes (etc.) into the isolated run.
 */
export async function syncWorkingTreeFilesIntoWorktree(
  mainRepoRoot: string,
  worktreeRoot: string,
  relativePaths: string[],
): Promise<string[]> {
  const synced: string[] = [];
  for (const rel of relativePaths) {
    const mainPath = path.join(mainRepoRoot, rel);
    const wtPath = path.join(worktreeRoot, rel);
    try {
      const mainContent = await readFile(mainPath, 'utf8');
      let worktreeContent: string | null = null;
      try {
        worktreeContent = await readFile(wtPath, 'utf8');
      } catch {
        worktreeContent = null;
      }
      if (worktreeContent === null || mainContent !== worktreeContent) {
        await mkdir(path.dirname(wtPath), { recursive: true });
        await writeFile(wtPath, mainContent, 'utf8');
        synced.push(rel);
      }
    } catch {
      /* main path missing */
    }
  }
  return synced;
}
