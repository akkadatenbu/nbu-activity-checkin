// src/api/db.js — PostgreSQL connection pool
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max:      parseInt(process.env.DB_POOL_MAX || '10'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
});

pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
});

/**
 * query helper — ใช้แทน pool.query โดยตรง
 * @param {string} text  - SQL query
 * @param {any[]}  params - parameters
 */
export const query = (text, params) => pool.query(text, params);

/**
 * transaction helper
 * @param {Function} fn - async function ที่รับ client
 */
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

export default pool;
