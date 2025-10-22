// Usage:
//   node createUser.js <username> <password> [--email you@example.com] [--phone 09...] [--dept-id 3] [--role 2] [--status active|inactive] [--prof-id 10]
// This script creates a new user with a bcrypt-hashed password in the users table.
// If --prof-id is supplied, it links the user to an existing professor (professors.id).

const bcrypt = require('bcrypt');
const pool = require('./db');

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v.startsWith('--')) {
            const key = v.replace(/^--/, '');
            const next = argv[i + 1];
            if (next && !next.startsWith('--')) {
                out[key] = next;
                i++;
            } else {
                out[key] = true;
            }
        } else {
            out._.push(v);
        }
    }
    return out;
}

async function createUser(username, password, opts = {}) {
    if (!username || !password) {
        console.error('Usage: node createUser.js <username> <password> [--email you@example.com] [--phone 09...] [--dept-id 3] [--role 2] [--status active|inactive] [--prof-id 10]');
        process.exit(1);
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        // Optional professor link validation
        let profIdValue = null;
        if (opts['prof-id'] !== undefined) {
            const profId = Number(opts['prof-id']);
            if (Number.isNaN(profId)) {
                console.error('Invalid --prof-id. It must be a number.');
                process.exit(1);
            }
            const [p] = await pool.query('SELECT id FROM professors WHERE id = ?', [profId]);
            if (!p || p.length === 0) {
                console.error(`Professor not found with id ${profId}.`);
                process.exit(1);
            }
            profIdValue = profId;
        }

        // Build dynamic insert for users table (keep minimal required columns, add optional if provided)
        const columns = ['username', 'password'];
        const values = [username, hashedPassword];

        if (opts.email) { columns.push('email'); values.push(String(opts.email)); }
        if (opts.phone) { columns.push('phone'); values.push(String(opts.phone)); }
        if (opts['dept-id'] !== undefined) { columns.push('dept_id'); values.push(Number(opts['dept-id']) || null); }
        if (opts.role !== undefined) { columns.push('role'); values.push(Number(opts.role) || null); }
        if (opts.status) { columns.push('status'); values.push(String(opts.status)); }
        if (profIdValue !== null) { columns.push('prof_id'); values.push(profIdValue); }

        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO users (${columns.join(', ')}) VALUES (${placeholders})`;
        const [result] = await pool.query(sql, values);
        console.log('User created successfully with ID:', result.insertId);
        if (profIdValue !== null) {
            console.log('Linked to professor id:', profIdValue);
        }
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            console.error('Username already exists.');
        } else {
            console.error('Error creating user:', err.message);
        }
        process.exit(1);
    }
}

const argv = process.argv.slice(2);
const parsed = parseArgs(argv);
const [username, password] = parsed._;
createUser(username, password, parsed);
