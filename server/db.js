import pg from 'pg';

// bigint -> Number (aman sampai ±9 kuadriliun rupiah), date -> string 'YYYY-MM-DD'
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number); // mis. tax_rate 2.50

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Menjalankan beberapa query sebagai satu kesatuan (semua berhasil atau semua batal).
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function required(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw new HttpError(400, `Kolom "${field}" wajib diisi`);
    }
  }
}
