/**
 * EngPro – Kết nối PostgreSQL
 *
 * server.js viết truy vấn theo kiểu quen thuộc:
 *   const [rows]   = await pool.query('SELECT * FROM users WHERE id=?', [id]);
 *   const [result] = await pool.query('INSERT INTO ... RETURNING id', [...]);  // result.insertId
 *   const [result] = await pool.query('UPDATE ...', [...]);                    // result.affectedRows
 *
 * File này đổi dấu ? thành $1, $2... theo chuẩn PostgreSQL. Tham số là mảng
 * (dùng cho "IN (?)") được bung thành $1,$2,$3. Không dùng dấu ? làm ký tự
 * thường bên trong câu SQL; muốn so sánh chuỗi có dấu ? thì truyền qua tham số.
 */
const { Pool, types } = require('pg');

// COUNT(*) trả về bigint và DECIMAL trả về numeric; mặc định pg đưa ra chuỗi.
// Đổi sang số để cộng trừ, so sánh trong JS không bị lỗi.
types.setTypeParser(types.builtins.INT8,    v => parseInt(v, 10));
types.setTypeParser(types.builtins.NUMERIC, v => parseFloat(v));

// Có DATABASE_URL (dịch vụ hosting thường cấp sẵn) thì dùng; chạy local thì dùng các biến PG* trong .env
const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host:     process.env.PGHOST     || '127.0.0.1',
      port:     Number(process.env.PGPORT) || 5432,
      user:     process.env.PGUSER     || 'postgres',
      password: process.env.PGPASSWORD || '',
      database: process.env.PGDATABASE || 'engpro',
    };
config.max = 10;
// Múi giờ Việt Nam để các thống kê theo tháng (doanh thu...) tính đúng ngày
config.options = `-c timezone=${process.env.DB_TIMEZONE || 'Asia/Ho_Chi_Minh'}`;

const pgPool = new Pool(config);

function toPostgres(sql, params = []) {
  const values = [];
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    const p = params[i++];
    if (Array.isArray(p)) {
      return p.map(v => { values.push(v); return '$' + values.length; }).join(',');
    }
    values.push(p);
    return '$' + values.length;
  });
  return { text, values };
}

function toResult(res) {
  if (res.command === 'SELECT') return [res.rows, res.fields];
  return [{ insertId: res.rows[0]?.id ?? null, affectedRows: res.rowCount, rows: res.rows }, res.fields];
}

function run(client, sql, params) {
  const { text, values } = toPostgres(sql, params);
  return client.query(text, values).then(toResult);
}

module.exports = {
  query: (sql, params) => run(pgPool, sql, params),
  pgPool, // pool gốc của thư viện pg, dùng cho kho lưu phiên đăng nhập (connect-pg-simple)

  // Dùng cho transaction: BEGIN → các truy vấn → COMMIT/ROLLBACK trên cùng một kết nối
  async getConnection() {
    const client = await pgPool.connect();
    return {
      query:            (sql, params) => run(client, sql, params),
      beginTransaction: () => client.query('BEGIN'),
      commit:           () => client.query('COMMIT'),
      rollback:         () => client.query('ROLLBACK'),
      release:          () => client.release(),
    };
  },

  end: () => pgPool.end(),
};
