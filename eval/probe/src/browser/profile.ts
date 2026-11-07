// Fresh_Profile (design: Browser driver; R14.4, R14.10). A new empty directory per measured run, used as
// Chrome's user-data dir so the HTTP cache, Cache Storage and IndexedDB all start empty, and deleted when
// the run ends. The file system is injected so the unit tests never touch the disk.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FRESH_PROFILE_PREFIX } from '../page-serve.ts';

export { FRESH_PROFILE_PREFIX };

export interface ProfileFs {
  /** Creates a new empty directory whose name starts with `prefix`; returns its absolute path. */
  makeDir(prefix: string): Promise<string>;
  /** Removes the directory and everything in it; a missing directory is not an error. */
  removeDir(dir: string): Promise<void>;
}

export const nodeProfileFs: ProfileFs = {
  makeDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
  removeDir: (dir) => rm(dir, { recursive: true, force: true }),
};

export class FreshProfile {
  readonly dir: string;
  private readonly fs: ProfileFs;
  private removed = false;

  private constructor(dir: string, fs: ProfileFs) {
    this.dir = dir;
    this.fs = fs;
  }

  static async create(fs: ProfileFs = nodeProfileFs): Promise<FreshProfile> {
    return new FreshProfile(await fs.makeDir(FRESH_PROFILE_PREFIX), fs);
  }

  get disposed(): boolean {
    return this.removed;
  }

  /** Deletes the profile. Safe to call more than once. */
  async dispose(): Promise<void> {
    if (this.removed) return;
    this.removed = true;
    await this.fs.removeDir(this.dir);
  }
}

/** Runs `body` on a new profile and deletes the profile in `finally`, whatever `body` does. */
export async function withFreshProfile<T>(fs: ProfileFs, body: (profile: FreshProfile) => Promise<T>): Promise<T> {
  const profile = await FreshProfile.create(fs);
  try {
    return await body(profile);
  } finally {
    await profile.dispose();
  }
}
