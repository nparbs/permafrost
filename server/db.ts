// Accounts, worlds and players in one SQLite file.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Account {
  id: string;
  name: string;
  paint: number;
}

export interface WorldRow {
  id: string;
  seed: number;
  width: number;
  season: number;
  started: number;
  /** Milliseconds this world has had somebody online. The day counter runs on it. */
  played: number;
  diffs: [number, number][];
  /** The market and the season's first finds, as the game saved them. */
  extra: unknown;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 16 characters from a 32-letter alphabet: 80 bits, easy to type on a phone. */
export function newToken(): string {
  const b = randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += ALPHABET[b[i] % 32];
  return s;
}

export const normalizeToken = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (token: string) => createHash('sha256').update(normalizeToken(token)).digest('hex');

export function packDiffs(pairs: Iterable<[number, number]>): Uint8Array {
  const list = [...pairs];
  const out = new Uint8Array(list.length * 4);
  const view = new DataView(out.buffer);
  list.forEach(([i, t], k) => view.setUint32(k * 4, ((i << 8) | (t & 255)) >>> 0, true));
  return out;
}

export function unpackDiffs(b: Uint8Array | null | undefined): [number, number][] {
  if (!b) return [];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: [number, number][] = [];
  for (let k = 0; k + 4 <= b.byteLength; k += 4) {
    const v = view.getUint32(k, true);
    out.push([v >>> 8, v & 255]);
  }
  return out;
}

function parse(s: string | null | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        paint INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL,
        seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        seed INTEGER NOT NULL,
        width INTEGER NOT NULL,
        season INTEGER NOT NULL,
        started INTEGER NOT NULL,
        diffs BLOB
      );
      CREATE TABLE IF NOT EXISTS players (
        account TEXT NOT NULL,
        world TEXT NOT NULL,
        season INTEGER NOT NULL,
        state TEXT NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (account, world)
      );
      CREATE TABLE IF NOT EXISTS seasons (
        world TEXT NOT NULL,
        season INTEGER NOT NULL,
        ended INTEGER NOT NULL,
        record TEXT NOT NULL,
        PRIMARY KEY (world, season)
      );
    `);
    // Added in v0.3.4. A world from before starts its day count at zero.
    const cols = this.db.prepare('PRAGMA table_info(worlds)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'played')) this.db.exec('ALTER TABLE worlds ADD COLUMN played INTEGER NOT NULL DEFAULT 0');
    // Added in v0.4.
    if (!cols.some((c) => c.name === 'extra')) this.db.exec('ALTER TABLE worlds ADD COLUMN extra TEXT');
  }

  create(name: string, paint: number): { account: Account; token: string } {
    const token = newToken();
    const id = randomBytes(5).toString('hex');
    const now = Date.now();
    this.db.prepare('INSERT INTO accounts (id, token_hash, name, paint, created, seen) VALUES (?, ?, ?, ?, ?, ?)').run(id, hash(token), name, paint, now, now);
    return { account: { id, name, paint }, token };
  }

  byToken(token: string): Account | null {
    const row = this.db.prepare('SELECT id, name, paint FROM accounts WHERE token_hash = ?').get(hash(token)) as Account | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE accounts SET seen = ? WHERE id = ?').run(Date.now(), row.id);
    return { ...row };
  }

  profile(id: string, name: string, paint: number): void {
    this.db.prepare('UPDATE accounts SET name = ?, paint = ? WHERE id = ?').run(name, paint, id);
  }

  world(id: string): WorldRow | null {
    const row = this.db.prepare('SELECT id, seed, width, season, started, played, diffs, extra FROM worlds WHERE id = ?').get(id) as
      | { id: string; seed: number; width: number; season: number; started: number; played: number; diffs: Uint8Array | null; extra: string | null }
      | undefined;
    if (!row) return null;
    return { id: row.id, seed: row.seed, width: row.width, season: row.season, started: row.started, played: row.played, diffs: unpackDiffs(row.diffs), extra: parse(row.extra) };
  }

  createWorld(id: string, seed: number, width: number, season = 1): WorldRow {
    const started = Date.now();
    this.db.prepare('INSERT INTO worlds (id, seed, width, season, started, diffs) VALUES (?, ?, ?, ?, ?, NULL)').run(id, seed, width, season, started);
    return { id, seed, width, season, started, played: 0, diffs: [], extra: null };
  }

  /** Start the next season: a new seed and an untouched map. Players' rows keep the old season number, so they start over. */
  rollWorld(id: string, seed: number, season: number, started: number): void {
    this.db.prepare('UPDATE worlds SET seed = ?, season = ?, started = ?, played = 0, diffs = NULL, extra = NULL WHERE id = ?').run(seed, season, started, id);
  }

  saveExtra(id: string, extra: unknown): void {
    this.db.prepare('UPDATE worlds SET extra = ? WHERE id = ?').run(JSON.stringify(extra), id);
  }

  /** Everyone with a rig in this world and season: account id, name and saved state. */
  seasonPlayers(world: string, season: number): { id: string; name: string; state: unknown }[] {
    const rows = this.db
      .prepare('SELECT p.account AS id, a.name AS name, p.state AS state FROM players p JOIN accounts a ON a.id = p.account WHERE p.world = ? AND p.season = ?')
      .all(world, season) as { id: string; name: string; state: string }[];
    return rows.map((r) => ({ id: r.id, name: r.name, state: parse(r.state) }));
  }

  /** The season an account last played in this world, if any. */
  playerSeason(account: string, world: string): number | null {
    const row = this.db.prepare('SELECT season FROM players WHERE account = ? AND world = ?').get(account, world) as { season: number } | undefined;
    return row ? row.season : null;
  }

  saveSeason(world: string, season: number, ended: number, record: unknown): void {
    this.db
      .prepare('INSERT INTO seasons (world, season, ended, record) VALUES (?, ?, ?, ?) ON CONFLICT(world, season) DO UPDATE SET ended = excluded.ended, record = excluded.record')
      .run(world, season, ended, JSON.stringify(record));
  }

  seasonRecord(world: string, season: number): unknown | null {
    const row = this.db.prepare('SELECT record FROM seasons WHERE world = ? AND season = ?').get(world, season) as { record: string } | undefined;
    return row ? parse(row.record) : null;
  }

  savePlayed(id: string, played: number): void {
    this.db.prepare('UPDATE worlds SET played = ? WHERE id = ?').run(Math.round(played), id);
  }

  saveWorld(id: string, pairs: Iterable<[number, number]>): void {
    this.db.prepare('UPDATE worlds SET diffs = ? WHERE id = ?').run(packDiffs(pairs), id);
  }

  loadPlayer(account: string, world: string, season: number): unknown | null {
    const row = this.db.prepare('SELECT state, season FROM players WHERE account = ? AND world = ?').get(account, world) as
      | { state: string; season: number }
      | undefined;
    if (!row || row.season !== season) return null;
    try {
      return JSON.parse(row.state);
    } catch {
      return null;
    }
  }

  savePlayer(account: string, world: string, season: number, state: unknown): void {
    this.db
      .prepare('INSERT INTO players (account, world, season, state, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account, world) DO UPDATE SET season = excluded.season, state = excluded.state, updated = excluded.updated')
      .run(account, world, season, JSON.stringify(state), Date.now());
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
  }

  close(): void {
    this.db.close();
  }
}
