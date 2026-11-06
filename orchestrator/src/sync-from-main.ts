import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execGit } from './git-exec.js';

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

export type UncommittedSyncResult = { copied: string[]; deleted: string[]; skipped: string[] };

/**
 * Mirror **uncommitted** changes from the main working tree into the SDLC worktree so local edits
 * are committed on the feature branch (not only what's in the last commit on `main`).
 * Set `sdlc.features.json` `syncUncommittedFromMain: false` to rely on `syncPathsFromMain` / AI only.
 */
export async function syncUncommittedFromMain(
  mainRepoRoot: string,
  worktreeRoot: string,
): Promise<UncommittedSyncResult> {
  const copied: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];

  const ns = execGit(mainRepoRoot, ['diff', '--name-status', 'HEAD'], true).trim();
  const trackedChanges = ns.startsWith('__GIT_FAIL__') || !ns ? [] : ns.split('\n');

  const others = execGit(mainRepoRoot, ['ls-files', '--others', '--exclude-standard'], true).trim();
  const untracked = others.startsWith('__GIT_FAIL__') || !others ? [] : others.split('\n').filter(Boolean);

  const seen = new Set<string>();

  for (const line of trackedChanges) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const status = line.slice(0, tab);
    const rest = line.slice(tab + 1).trim();
    /** rename: old\tnew — file on disk is only at `new` */
    const paths = rest.includes('\t') ? rest.split('\t') : [rest];
    if ((status.startsWith('R') || status.startsWith('C')) && paths.length >= 2) {
      const oldPath = paths[0];
      if (oldPath && !seen.has(oldPath)) {
        try {
          await rm(path.join(worktreeRoot, oldPath), { force: true });
          deleted.push(oldPath);
        } catch {
          /* old path may not exist in worktree */
        }
        seen.add(oldPath);
      }
    }
    const rels =
      status.startsWith('R') || status.startsWith('C') ? paths.slice(-1) : paths;
    for (const rel of rels) {
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      const src = path.join(mainRepoRoot, rel);
      const dest = path.join(worktreeRoot, rel);
      if (status.startsWith('D')) {
        try {
          await rm(dest, { force: true });
          deleted.push(rel);
        } catch {
          skipped.push(rel);
        }
        continue;
      }
      try {
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(src, dest);
        copied.push(rel);
      } catch {
        skipped.push(rel);
      }
    }
  }

  for (const rel of untracked) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = path.join(mainRepoRoot, rel);
    const dest = path.join(worktreeRoot, rel);
    try {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(src, dest);
      copied.push(rel);
    } catch {
      skipped.push(rel);
    }
  }

  return { copied, deleted, skipped };
}
