// src/api/db.js — PostgreSQL connection pool
import pg from 'pg';
const { Pool } = pg;

const poolConfig = {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
};

// ─── Main DB (nbu-actmenu) ────────────────────────────────────────────────────
const pool = new Pool({
    ...poolConfig,
    database: process.env.DB_NAME,
    max:      parseInt(process.env.DB_POOL_MAX || '10'),
});

pool.on('error', (err) => console.error('PostgreSQL pool error:', err));

export const query = (text, params) => pool.query(text, params);

export const transaction = async (fn) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

// ─── AVS_DB (ระบบทะเบียน — real-time LINE mapping) ───────────────────────────
const avsPool = new Pool({
    ...poolConfig,
    database: process.env.AVS_DB_NAME || 'AVS_DB',
    max:      5,
});

avsPool.on('error', (err) => console.error('AVS_DB pool error:', err));

export const queryAvs = (text, params) => avsPool.query(text, params);

export default pool;
