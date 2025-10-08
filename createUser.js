// Usage: node createUser.js <username> <password>
// This script creates a new user with a bcrypt-hashed password in the users table.

const bcrypt = require('bcrypt');
const pool = require('./db');

async function createUser(username, password) {
    if (!username || !password) {
        console.error('Usage: node createUser.js <username> <password>');
        process.exit(1);
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (username, password) VALUES (?, ?)',
            [username, hashedPassword]
        );
        console.log('User created successfully with ID:', result.insertId);
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

const [,, username, password] = process.argv;
createUser(username, password);
