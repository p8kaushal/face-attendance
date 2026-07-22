import pg from 'pg';
const { Pool } = pg;

let pool;

export async function initDB() {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      external_id VARCHAR(255) UNIQUE,
      employee_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      face_descriptor TEXT NOT NULL,
      image_data TEXT,
      username VARCHAR(50) UNIQUE,
      password_hash VARCHAR(255),
      role VARCHAR(20) DEFAULT 'attendee',
      created_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE,
    ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'attendee'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      check_in TIMESTAMP NOT NULL,
      check_out TIMESTAMP,
      date DATE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      latitude DOUBLE PRECISION NOT NULL,
      longitude DOUBLE PRECISION NOT NULL,
      radius_meters DOUBLE PRECISION DEFAULT 100,
      host_id INTEGER,
      host_image TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS host_id BIGINT,
    ADD COLUMN IF NOT EXISTS host_image TEXT
  `);

  await pool.query(`
    ALTER TABLE events
    ALTER COLUMN host_id TYPE BIGINT
  `);

  await pool.query(`
    ALTER TABLE attendance 
    ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id),
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS offline_uuid VARCHAR(255) UNIQUE
  `);

  // Migration logic from admin_users to users
  try {
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'admin_users'
      )
    `);

    if (tableCheck.rows[0].exists) {
      console.log('Migrating admin_users table to users table...');
      const adminUsers = await pool.query('SELECT * FROM admin_users');
      
      for (const row of adminUsers.rows) {
        const userCheck = await pool.query('SELECT id FROM users WHERE username = $1', [row.username]);
        if (userCheck.rows.length === 0) {
          const empId = 'MIGRATED_' + row.username + '_' + Math.floor(Math.random() * 1000);
          const userRole = row.role || 'admin';
          await pool.query(
            `INSERT INTO users (employee_id, name, face_descriptor, username, password_hash, role, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [empId, row.username, '[]', row.username, row.password_hash, userRole, 'migration']
          );
        }
      }
      
      // Drop the old admin_users table
      await pool.query('DROP TABLE admin_users');
      console.log('Migrated data successfully. Dropped admin_users table.');
    }
  } catch (err) {
    console.error('Error migrating admin_users table:', err);
  }

  // Insert default admin user directly into users table
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminUsername && adminPassword) {
    const crypto = await import('crypto');
    const hashedPassword = crypto.default.createHash('sha256')
      .update(adminPassword + process.env.SESSION_SECRET)
      .digest('hex');
    
    await pool.query(`
      INSERT INTO users (employee_id, name, face_descriptor, username, password_hash, role, created_by)
      VALUES ($1, $1, '[]', $1, $2, 'admin', 'system')
      ON CONFLICT (username) DO NOTHING
    `, [adminUsername, hashedPassword]);
  }

  console.log('Database initialized');
}

export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

export async function getClient() {
  return pool.connect();
}
