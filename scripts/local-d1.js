import { DatabaseSync } from "node:sqlite";

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    const next = new Statement(this.db, this.sql);
    next.params = params;
    return next;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: info.changes } };
  }
}

export class LocalD1 {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }
}
