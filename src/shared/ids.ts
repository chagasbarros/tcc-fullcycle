import { v7 } from 'uuid';

/**
 * UUID v7 (CLAUDE.md, section 9): time-ordered, so new rows land at the end of
 * the primary key index instead of random pages (better insert performance than v4).
 */
export function newId(): string {
  return v7();
}
