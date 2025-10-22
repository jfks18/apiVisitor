const express = require('express');
const db = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
let sendEmail;
try {
    ({ sendEmail } = require('./mailer'));
} catch (smtpErr) {
    console.error('SMTP configuration error on startup:', smtpErr?.message || smtpErr);
    process.exit(1);
}
require('dotenv').config();

const app = express();

const cors = require('cors');
app.use(cors({
    origin: ['https://visitormonitoring.onrender.com', 'http://localhost:3000'],
    credentials: true,
    allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'access-control-allow-origin',
        'Authorization',
        'ngrok-skip-browser-warning'
    ],
    preflightContinue: false,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']
}));

app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Simple request logger to help debug Render requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// Root route so accessing '/' returns 200 instead of Not Found
app.get('/', (req, res) => res.json({ status: 'ok', message: 'Visitor Monitoring API' }));

app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

app.post('/api/visitorsdata', async (req, res) => {
    console.log('Received data:', req.body);
    const {
        visitorsID,
        first_name,
        middle_name,
        last_name,
        suffix,
        gender,
        birth_date,
        address,
        phone
    } = req.body;

    try {
        const [result] = await db.execute(
            'INSERT INTO visitorsdata (visitorsID, first_name, middle_name, last_name, suffix, gender, birth_date, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                visitorsID ?? null,
                first_name ?? null,
                middle_name ?? null,
                last_name ?? null,
                suffix ?? null,
                gender ?? null,
                birth_date ?? null,
                address ?? null,
                phone ?? null
            ]
        );
        res.status(201).json({ message: 'Visitor data added successfully', id: result.insertId });   
    } catch (error) {
        console.error('Error inserting visitor data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get('/api/visitorsdata/:visitorsID', async (req, res) => {
    console.log('Received data:', req.body);
    try {
        const { visitorsID } = req.params;
        const [rows] = await db.execute('SELECT * FROM visitorsdata WHERE visitorsID = ?', [visitorsID]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Visitor not found' });
        }
        const visitor = {
            ...rows[0],
            faculty_to_visit: rows[0].faculty_to_visit ? JSON.parse(rows[0].faculty_to_visit) : []
        };
        res.json(visitor);
    } catch (error) {
        console.error('Error fetching visitor data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/visitorslog/timein', async (req, res) => {
    const { visitorsID } = req.body;
    if (!visitorsID) {
        return res.status(400).json({ message: 'visitorsID is required' });
    }
    const now = new Date();
    const timeIn = now.toTimeString().split(' ')[0];
    try {
        await db.execute('UPDATE visitorslog SET timein = ? WHERE visitorsID = ?', [timeIn, visitorsID]);
        res.status(200).json({ message: 'Time in recorded', visitorsID, timeIn });
    } catch (error) {
        console.error('Error saving time in:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/visitorslog/timeout', async (req, res) => {
    const { visitorsID } = req.body;
    if (!visitorsID) {
        return res.status(400).json({ message: 'visitorsID is required' });
    }
    try {
        // Compute Manila date and time
        const manilaDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()); // YYYY-MM-DD
        const timeOut = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Manila', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date()); // HH:mm:ss

        // Validate that all today's office visits for this visitor are tagged (qr_tagged = 1)
        const [checkRows] = await db.execute(
            'SELECT COUNT(*) AS total, SUM(CASE WHEN qr_tagged = 1 THEN 1 ELSE 0 END) AS tagged FROM office_visits WHERE visitorsID = ? AND DATE(createdAt) = ?',
            [visitorsID, manilaDate]
        );
        const { total, tagged } = checkRows[0] || { total: 0, tagged: 0 };
        if (!total || total === 0) {
            return res.status(400).json({ message: 'No office visits found for today for this visitor', visitorsID, date: manilaDate });
        }
        if (Number(tagged) < Number(total)) {
            return res.status(400).json({ message: 'Not all offices have been tagged for today', visitorsID, date: manilaDate, tagged: Number(tagged), total: Number(total) });
        }

        // All tagged, proceed to timeout update (keep existing schema column name casing)
        await db.execute('UPDATE visitorslog SET timeout = ? WHERE visitorsID = ?', [timeOut, visitorsID]);
        res.status(200).json({ message: 'Time out recorded', visitorsID, timeOut });
    } catch (error) {
        console.error('Error saving time out:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/visitorslog', async (req, res) => {
    const { visitorsID } = req.body;
    if (!visitorsID) {
        return res.status(400).json({ message: 'visitorsID is required' });
    }
    try {
        await db.execute('INSERT INTO visitorslog (visitorsID) VALUES (?)', [visitorsID]);
        res.status(201).json({ message: 'Visitor log saved', visitorsID });
    } catch (error) {
        console.error('Error saving visitor log:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/visitorslog - list visitor logs with optional filters
app.get('/api/visitorslog', async (req, res) => {
    const { visitorsID, startDate, endDate, createdAt } = req.query;
    try {
        let query = 'SELECT * FROM visitorslog';
        const where = [];
        const params = [];
        if (visitorsID) { where.push('visitorsID = ?'); params.push(visitorsID); }
        if (startDate && endDate && startDate !== '' && endDate !== '') {
            where.push('DATE(createdAt) BETWEEN ? AND ?');
            params.push(startDate, endDate);
        } else if (createdAt && createdAt !== '') {
            where.push('DATE(createdAt) = ?');
            params.push(createdAt);
        }
        if (where.length) query += ' WHERE ' + where.join(' AND ');
        query += ' ORDER BY createdAt DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching visitor logs:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/api/visitorslog/:visitorsID', async (req, res) => {
    const { visitorsID } = req.params;
    try {
        const [rows] = await db.execute('SELECT * FROM visitorslog WHERE visitorsID = ?', [visitorsID]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'No visitor logs found for this visitorsID' });
        }
        res.json(rows);
    } catch (error) {
        console.error('Error fetching visitor log:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/visitorslog/scan', async (req, res) => {
    console.log('Scan received data:', req.body);
    const { visitorsID } = req.body;
    if (!visitorsID) {
        return res.status(400).json({ message: 'visitorsID is required' });
    }
    const now = new Date();
    const currentTime = now.toTimeString().split(' ')[0];
    try {
        // Pre-check: get the latest log for this visitor
        const [rows] = await db.execute('SELECT * FROM visitorslog WHERE visitorsID = ? ORDER BY logid DESC LIMIT 1', [visitorsID]);
        if (rows.length > 0 && rows[0].timeIn && rows[0].timeOut) {
            return res.status(400).json({ message: 'Already timed in and out. Please wait for a new log to be created by the system.' });
        }
        // Try to update a log with timeIn IS NULL or empty
        let [updateResult] = await db.execute('UPDATE visitorslog SET timeIn = ? WHERE visitorsID = ? AND (timeIn IS NULL OR timeIn = "")', [currentTime, visitorsID]);
        if (updateResult.affectedRows > 0) {
            return res.status(200).json({ message: 'Time in recorded', visitorsID, timeIn: currentTime });
        }
        // If already timed in, update timeOut if not set
        [updateResult] = await db.execute('UPDATE visitorslog SET timeOut = ? WHERE visitorsID = ? AND timeIn IS NOT NULL AND (timeOut IS NULL OR timeOut = "")', [currentTime, visitorsID]);
        if (updateResult.affectedRows > 0) {
            return res.status(200).json({ message: 'Time out recorded', visitorsID, timeOut: currentTime });
        }
        // If no log was updated, return not found
        return res.status(404).json({ message: 'No log found to update time in or out.' });
    } catch (error) {
        console.error('Error processing scan:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/api/visitors-joined', async (req, res) => {   
    const { createdAt } = req.query;
    try {
        let query = `SELECT vd.*, vl.logid, vl.timeIn, vl.timeOut, vl.createdAt as logCreatedAt
                     FROM visitorsdata vd
                     JOIN visitorslog vl ON vd.visitorsID = vl.visitorsID`;
        const params = [];
        if (createdAt) {
            query += ' WHERE DATE(vl.createdAt) = ?';
            params.push(createdAt);
        }
        query += ' ORDER BY vl.createdAt DESC';
        const [rows] = await db.execute(query, params);
        const result = rows.map(row => ({
            ...row,
            faculty_to_visit: row.faculty_to_visit ? JSON.parse(row.faculty_to_visit) : []
        }));
        res.json(result);
        console.log('Joined visitor data:', result);
    } catch (error) {
        console.error('Error fetching joined visitor data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.get('/api/visitors', async (req, res) => {
    const { createdAt, startDate, endDate } = req.query;
    console.log('Received query parameters:', req.query);
    try {
        let query = `SELECT vd.*, vl.logid, vl.timeIn, vl.timeOut, vl.createdAt as logCreatedAt
                     FROM visitorsdata vd
                     JOIN visitorslog vl ON vd.visitorsID = vl.visitorsID`;
        const params = [];
        if (startDate && endDate && startDate !== '' && endDate !== '') {
            query += ' WHERE DATE(vl.createdAt) BETWEEN ? AND ?';
            params.push(startDate, endDate);
            console.log('Filtering by date range:', startDate, endDate);
        } else if (createdAt && createdAt !== '') {
            query += ' WHERE DATE(vl.createdAt) = ?';
            params.push(createdAt);
            console.log('Filtering by createdAt:', createdAt);
        }
        query += ' ORDER BY vl.createdAt DESC';
        console.log('Final query:', query);
        console.log('Query params:', params);
        const [rows] = await db.execute(query, params);
        const visitors = rows.map(row => ({
            ...row,
            faculty_to_visit: row.faculty_to_visit ? JSON.parse(row.faculty_to_visit) : [],
            logCreatedAtUTC: row.logCreatedAt ? new Date(row.logCreatedAt).toISOString() : null
        }));
        res.json(visitors);
        console.log('Visitors data:', visitors);
    } catch (error) {
        console.error('Error fetching visitors by date:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }
    try {
        console.log('Login attempt:', { username });
        const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        console.log('User query returned:', rows.length, 'row(s)');
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }
        const user = rows[0];
        console.log('User role info:', { role: user?.role ?? null, role_id: user?.role_id ?? null });
        if (user?.role_id !== undefined && user?.role_id !== null) {
            try {
                const [roleRows] = await db.execute('SELECT * FROM roles WHERE id = ?', [user.role_id]);
                console.log('Role lookup result:', roleRows && roleRows[0] ? roleRows[0] : null);
            } catch (roleErr) {
                console.error('Role lookup error:', roleErr);
            }
        }
        const passwordMatch = await bcrypt.compare(password, user.password);
        console.log('Password match:', passwordMatch);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }
        const adminToken = crypto.randomBytes(32).toString('hex');
        // set token and mark status active
        await db.execute('UPDATE users SET token = ?, status = ? WHERE id = ?', [adminToken, 'active', user.id]);
        const [updatedRows] = await db.execute('SELECT id, username, email, phone, dept_id, token, role , prof_id, status, createdAt FROM users WHERE id = ?', [user.id]);
        const userUpdated = updatedRows[0];
        res.json({ message: 'Login successful', user: userUpdated });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Logout - clear token and set status inactive
app.post('/api/logout', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required.' });
    }
    try {
        const [result] = await db.execute('UPDATE users SET token = NULL, status = ? WHERE username = ?', ['inactive', username]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'Logout successful', username });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/users', async (req, res) => {
    const { username, email, phone, password, dept_id, status, role } = req.body || {};
    if (!username || !email || !phone) {
        return res.status(400).json({ message: 'username, email and phone are required' });
    }
    try {
        // If password not provided, generate a temporary one
        const plainPassword = password && String(password).trim() !== ''
            ? String(password)
            : crypto.randomBytes(8).toString('hex'); // 16-char hex temp password

        const hashed = await bcrypt.hash(plainPassword, 10);
        // default status to 'inactive' if not provided
        const finalStatus = status || 'inactive';
        // default role to 2 if not provided
        const finalRole = role ?? 2;
        const [result] = await db.execute(
            'INSERT INTO users (username, email, phone, password, dept_id, status, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, phone, hashed, dept_id || null, finalStatus, finalRole]
        );

        // Attempt to email the credentials to the user
        let emailSent = false;
        let emailError = undefined;
        try {
            const subject = 'Your account has been created';
            const text = `Hello ${username},\n\nYour account has been created.\n\nUsername: ${username}\nPassword: ${plainPassword}\n\nFor your security, please sign in and change your password immediately.`;
            const html = `<p>Hello ${username},</p><p>Your account has been created.</p><p><b>Username:</b> ${username}<br/><b>Password:</b> ${plainPassword}</p><p>For your security, please sign in and change your password immediately.</p>`;
            await sendEmail({ to: email, subject, text, html });
            emailSent = true;
        } catch (mailErr) {
            emailError = mailErr?.message || String(mailErr);
            console.error('Email send failed (user created):', mailErr);
        }

        res.status(201).json({
            message: 'User created',
            id: result.insertId,
            status: finalStatus,
            role: finalRole,
            emailSent,
            emailError: emailSent ? undefined : emailError
        });
    } catch (err) {
        console.error('Error creating user:', err);
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'User already exists' });
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ---------------- email endpoints ----------------
// POST /api/email/send - send an email via SMTP
// Body: { to: string | string[], subject: string, text?: string, html?: string, from?: string }
app.post('/api/email/send', async (req, res) => {
    const { to, subject, text, html, from } = req.body || {};
    if (!to || !subject) {
        return res.status(400).json({ message: 'to and subject are required' });
    }
    try {
        const result = await sendEmail({ to, subject, text, html, from });
        res.status(200).json({ message: 'Email sent', ...result });
    } catch (err) {
        console.error('Error sending email:', err);
        res.status(500).json({ message: 'Failed to send email', error: err?.message || String(err) });
    }
});

// POST /api/offices - Add a new office
app.post('/api/offices', async (req, res) => {
    const { department } = req.body;
    if (!department) {
        return res.status(400).json({ message: 'Department is required.' });
    }
    try {
        const [result] = await db.execute(
            'INSERT INTO offices (department) VALUES (?)',
            [department]
        );
        res.status(201).json({ message: 'Office added successfully', id: result.insertId });
    } catch (error) {
        console.error('Error inserting office:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/offices - Get all offices
app.get('/api/offices', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM offices ORDER BY createdAt DESC');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching offices:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/professors - Add a new professor
app.post('/api/professors', async (req, res) => {
    const {
        first_name,
        last_name,
        middle_name,
        birth_date,
        phone,
        email,
        position,
        department
    } = req.body;
    if (!first_name || !last_name || !middle_name || !birth_date || !phone || !email || !position || !department) {
        return res.status(400).json({ message: 'All fields are required.' });
    }
    try {
        const [result] = await db.execute(
            'INSERT INTO professors (first_name, last_name, middle_name, birth_date, phone, email, position, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [first_name, last_name, middle_name, birth_date, phone, email, position, department]
        );
        res.status(201).json({ message: 'Professor added successfully', id: result.insertId });
    } catch (error) {
        console.error('Error inserting professor:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/professors - Get all professors
app.get('/api/professors', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM professors ORDER BY createdAt DESC');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching professors:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/professors/department/:departmentId - Get professors by department (office) id
app.get('/api/professors/department/:departmentId', async (req, res) => {
    const { departmentId } = req.params;
    try {
        const [rows] = await db.execute(
            `SELECT p.*,
                    (
                        SELECT u.id FROM users u
                        WHERE u.prof_id = p.id
                        ORDER BY u.createdAt DESC
                        LIMIT 1
                    ) AS user_id,
                    (
                        SELECT u.status FROM users u
                        WHERE u.prof_id = p.id
                        ORDER BY u.createdAt DESC
                        LIMIT 1
                    ) AS user_status
             FROM professors p
             WHERE p.department = ?
             ORDER BY p.createdAt DESC`,
            [departmentId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching professors by department:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/offices/:id - Delete an office by ID
app.delete('/api/offices/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: 'Office ID is required.' });
    }
    try {
        const [result] = await db.execute('DELETE FROM offices WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Office not found.' });
        }
        res.json({ message: 'Office deleted successfully', id });
    } catch (error) {
        console.error('Error deleting office:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/offices/:id - Update the department of an office by ID
app.put('/api/offices/:id', async (req, res) => {
    const { id } = req.params;
    const { department } = req.body;
    if (!id || !department) {
        return res.status(400).json({ message: 'Office ID and new department are required.' });
    }
    try {
        const [result] = await db.execute('UPDATE offices SET department = ? WHERE id = ?', [department, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Office not found.' });
        }
        res.json({ message: 'Office updated successfully', id, department });
    } catch (error) {
        console.error('Error updating office:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/professors/:id - Delete a professor by ID
app.delete('/api/professors/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: 'Professor ID is required.' });
    }
    try {
        const [result] = await db.execute('DELETE FROM professors WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Professor not found.' });
        }
        res.json({ message: 'Professor deleted successfully', id });
    } catch (error) {
        console.error('Error deleting professor:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/professors/:id - Update professor details by ID
app.put('/api/professors/:id', async (req, res) => {
    const { id } = req.params;
    const {
        first_name,
        last_name,
        middle_name,
        birth_date,
        phone,
        email,
        position,
        department
    } = req.body;
    if (!id) {
        return res.status(400).json({ message: 'Professor ID is required.' });
    }
    // Only update fields that are provided
    const fields = [];
    const values = [];
    if (first_name !== undefined) { fields.push('first_name = ?'); values.push(first_name); }
    if (last_name !== undefined) { fields.push('last_name = ?'); values.push(last_name); }
    if (middle_name !== undefined) { fields.push('middle_name = ?'); values.push(middle_name); }
    if (birth_date !== undefined) { fields.push('birth_date = ?'); values.push(birth_date); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }
    if (position !== undefined) { fields.push('position = ?'); values.push(position); }
    if (department !== undefined) { fields.push('department = ?'); values.push(department); }
    if (fields.length === 0) {
        return res.status(400).json({ message: 'No fields provided to update.' });
    }
    values.push(id);
    try {
        const [result] = await db.execute(`UPDATE professors SET ${fields.join(', ')} WHERE id = ?`, values);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Professor not found.' });
        }
        res.json({ message: 'Professor updated successfully', id });
    } catch (error) {
        console.error('Error updating professor:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM department');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- Users CRUD for department accounts ---

// Update user
app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, email, phone, password, dept_id, status, role } = req.body;
    if (!id) return res.status(400).json({ message: 'User id is required' });
    try {
        const fields = [];
        const values = [];
        if (username !== undefined) { fields.push('username = ?'); values.push(username); }
        if (email !== undefined) { fields.push('email = ?'); values.push(email); }
        if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (dept_id !== undefined) { fields.push('dept_id = ?'); values.push(dept_id); }
    if (status !== undefined) { fields.push('status = ?'); values.push(status); }
    if (role !== undefined) { fields.push('role = ?'); values.push(role); }
        if (password !== undefined) {
            const hashed = await bcrypt.hash(password, 10);
            fields.push('password = ?');
            values.push(hashed);
        }
        if (fields.length === 0) return res.status(400).json({ message: 'No fields provided to update' });
        values.push(id);
        const [result] = await db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'User updated', id });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Delete user
app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'User id is required' });
    try {
        const [result] = await db.execute('DELETE FROM users WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'User deleted', id });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/users - list users (optional ?dept_id=)
app.get('/api/users', async (req, res) => {
    const { dept_id } = req.query;
    try {
    let query = 'SELECT id, username, email, phone, dept_id, token, status, role, createdAt FROM users';
        const params = [];
        if (dept_id) {
            query += ' WHERE dept_id = ?';
            params.push(dept_id);
        }
        query += ' ORDER BY createdAt DESC';
        const [rows] = await db.execute(query, params);
        // Do not return password
    const users = rows.map(u => ({ ...u, password: undefined }));
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/users/:id - get single user (omit password)
app.get('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'User id is required' });
    try {
    const [rows] = await db.execute('SELECT id, username, email, phone, dept_id, token, status, role, createdAt FROM users WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching user:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ---------------- office_visits endpoints ----------------
// GET /api/office_visits - list visits, optional filters ?visitorsID=&dept_id=&prof_id=
app.get('/api/office_visits', async (req, res) => {
    const { visitorsID, dept_id, id } = req.query;
    try {
        let query = 'SELECT * FROM office_visits';
        const clauses = [];
        const params = [];
        if (visitorsID) { clauses.push('visitorsID = ?'); params.push(visitorsID); }
        if (dept_id) { clauses.push('dept_id = ?'); params.push(dept_id); }
        if (id) { clauses.push('prof_id = ?'); params.push(id); }
        if (clauses.length) query += ' WHERE ' + clauses.join(' AND ');
        query += ' ORDER BY createdAt DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching office_visits:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/office_visits/:id - get single visit
app.get('/api/office_visits/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Visit id is required' });
    try {
        const [rows] = await db.execute('SELECT * FROM office_visits WHERE prof_id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Visit not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching office_visit:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/office_visits/by-professor/:prof_id - visits by professor id
app.get('/api/office_visits/by-professor/:prof_id', async (req, res) => {
    const { prof_id } = req.params;
    if (!prof_id) return res.status(400).json({ message: 'Professor id is required' });
    try {
        const [rows] = await db.execute('SELECT * FROM office_visits WHERE prof_id = ? ORDER BY createdAt DESC', [prof_id]);
        res.json(rows);
    } catch (err) {
        console.error('Error fetching office_visits for professor:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// -------- Professor-Users association CRUD --------
// GET /api/professor-users - list users joined with professors (where users.prof_id not null)
app.get('/api/professor-users', async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT u.id AS user_id, u.username, u.email, u.phone, u.dept_id, u.role, u.prof_id, u.status,
                   p.id AS professor_id, p.first_name, p.last_name, p.middle_name, p.email AS prof_email, p.department
            FROM users u
            LEFT JOIN professors p ON u.prof_id = p.id
            WHERE u.prof_id IS NOT NULL
            ORDER BY u.createdAt DESC
        `);
        res.json(rows);
    } catch (err) {
        console.error('Error listing professor-users:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/professor-users/:userId - single user joined with professor
    app.get('/api/professor-users/:userId', async (req, res) => {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ message: 'User id is required' });
        try {
            const [rows] = await db.execute(`
                SELECT u.id AS user_id, u.username, u.email, u.phone, u.dept_id, u.role, u.prof_id, u.status,
                    p.id AS professor_id, p.first_name, p.last_name, p.middle_name, p.email AS prof_email, p.department
                FROM users u
                LEFT JOIN professors p ON u.prof_id = p.id
                WHERE p.id = ?
            `, [userId]);
            if (rows.length === 0) return res.status(404).json({ message: 'User not found' });
            res.json(rows[0]);
        } catch (err) {
            console.error('Error fetching professor-user:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    });

// POST /api/professor-users - link a user to a professor (set users.prof_id)
app.post('/api/professor-users', async (req, res) => {
    const { user_id, prof_id } = req.body;
    if (!user_id || !prof_id) return res.status(400).json({ message: 'user_id and prof_id are required' });
    try {
        // validate user exists
        const [u] = await db.execute('SELECT id FROM users WHERE id = ?', [user_id]);
        if (u.length === 0) return res.status(404).json({ message: 'User not found' });
        // validate professor exists
        const [p] = await db.execute('SELECT id FROM professors WHERE id = ?', [prof_id]);
        if (p.length === 0) return res.status(404).json({ message: 'Professor not found' });
        const [result] = await db.execute('UPDATE users SET prof_id = ? WHERE id = ?', [prof_id, user_id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
        res.status(200).json({ message: 'Professor linked to user', user_id, prof_id });
    } catch (err) {
        console.error('Error linking professor to user:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/professor-users/:userId - change linked professor for a user
app.put('/api/professor-users/:userId', async (req, res) => {
    const { userId } = req.params;
    const { prof_id } = req.body;
    if (!userId || prof_id === undefined) return res.status(400).json({ message: 'userId and prof_id are required' });
    try {
        const [p] = await db.execute('SELECT id FROM professors WHERE id = ?', [prof_id]);
        if (p.length === 0) return res.status(404).json({ message: 'Professor not found' });
        const [result] = await db.execute('UPDATE users SET prof_id = ? WHERE id = ?', [prof_id, userId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'Professor link updated', user_id: Number(userId), prof_id });
    } catch (err) {
        console.error('Error updating professor link:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/professor-users/:userId - unlink professor from user (set prof_id to NULL)
app.delete('/api/professor-users/:userId', async (req, res) => {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ message: 'User id is required' });
    try {
        const [result] = await db.execute('UPDATE users SET prof_id = NULL WHERE id = ?', [userId]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'User not found' });
        res.json({ message: 'Professor unlinked from user', user_id: Number(userId) });
    } catch (err) {
        console.error('Error unlinking professor from user:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/professor-users/by-professor/:prof_id - update professor data and any linked users by prof_id
app.put('/api/professor-users/by-professor/:prof_id', async (req, res) => {
    const { prof_id } = req.params;
    const { professor, user } = req.body || {};
    if (!prof_id) return res.status(400).json({ message: 'prof_id is required' });

    // Build professor update if provided
    const profFields = [];
    const profValues = [];
    if (professor && typeof professor === 'object') {
        const {
            first_name,
            last_name,
            middle_name,
            birth_date,
            phone,
            email,
            position,
            department
        } = professor;
        if (first_name !== undefined) { profFields.push('first_name = ?'); profValues.push(first_name); }
        if (last_name !== undefined) { profFields.push('last_name = ?'); profValues.push(last_name); }
        if (middle_name !== undefined) { profFields.push('middle_name = ?'); profValues.push(middle_name); }
        if (birth_date !== undefined) { profFields.push('birth_date = ?'); profValues.push(birth_date); }
        if (phone !== undefined) { profFields.push('phone = ?'); profValues.push(phone); }
        if (email !== undefined) { profFields.push('email = ?'); profValues.push(email); }
        if (position !== undefined) { profFields.push('position = ?'); profValues.push(position); }
        if (department !== undefined) { profFields.push('department = ?'); profValues.push(department); }
    }

    // Build user update if provided (applies to all users with this prof_id)
    const userFields = [];
    const userValues = [];
    let userPasswordToHash = undefined;
    if (user && typeof user === 'object') {
        const {
            username,
            email: user_email,
            phone: user_phone,
            dept_id,
            status,
            role,
            password
        } = user;
        if (username !== undefined) { userFields.push('username = ?'); userValues.push(username); }
        if (user_email !== undefined) { userFields.push('email = ?'); userValues.push(user_email); }
        if (user_phone !== undefined) { userFields.push('phone = ?'); userValues.push(user_phone); }
        if (dept_id !== undefined) { userFields.push('dept_id = ?'); userValues.push(dept_id); }
        if (status !== undefined) { userFields.push('status = ?'); userValues.push(status); }
        if (role !== undefined) { userFields.push('role = ?'); userValues.push(role); }
        if (password !== undefined) { userPasswordToHash = password; }
    }

    if (profFields.length === 0 && userFields.length === 0 && userPasswordToHash === undefined) {
        return res.status(400).json({ message: 'No fields provided to update for professor or user' });
    }

    try {
        let updatedProfessor = 0;
        let updatedUsers = 0;

        // Update professor first if specified
        if (profFields.length > 0) {
            const params = [...profValues, prof_id];
            const [profRes] = await db.execute(`UPDATE professors SET ${profFields.join(', ')} WHERE id = ?`, params);
            if (profRes.affectedRows === 0) return res.status(404).json({ message: 'Professor not found' });
            updatedProfessor = profRes.affectedRows;
        }

        // If password is provided, hash once (applied to all linked users)
        if (userPasswordToHash !== undefined) {
            const hashed = await bcrypt.hash(userPasswordToHash, 10);
            userFields.push('password = ?');
            userValues.push(hashed);
        }

        if (userFields.length > 0) {
            const params = [...userValues, prof_id];
            const [userRes] = await db.execute(`UPDATE users SET ${userFields.join(', ')} WHERE prof_id = ?`, params);
            updatedUsers = userRes.affectedRows || 0;
        }

        return res.json({
            message: 'Professor/users updated',
            prof_id: Number(prof_id),
            updatedProfessor,
            updatedUsers
        });
    } catch (err) {
        console.error('Error updating by professor id:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/office_visits - create a new office visit
app.post('/api/office_visits', async (req, res) => {
    const { visitorsID, dept_id, prof_id, purpose } = req.body;
    if (!visitorsID || !dept_id || !prof_id || !purpose) {
        return res.status(400).json({ message: 'visitorsID, dept_id, prof_id and purpose are required' });
    }
    try {
        const [result] = await db.execute(
            'INSERT INTO office_visits (visitorsID, dept_id, prof_id, purpose) VALUES (?, ?, ?, ?)',
            [visitorsID, dept_id, prof_id, purpose]
        );
        res.status(201).json({ message: 'Visit created', id: result.insertId });
    } catch (err) {
        console.error('Error creating office_visit:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/office_visits/:id - update a visit
app.put('/api/office_visits/:id', async (req, res) => {
    const { id } = req.params;
    const { visitorsID, dept_id, prof_id, purpose } = req.body;
    if (!id) return res.status(400).json({ message: 'Visit id is required' });
    try {
        const fields = [];
        const values = [];
        if (visitorsID !== undefined) { fields.push('visitorsID = ?'); values.push(visitorsID); }
        if (dept_id !== undefined) { fields.push('dept_id = ?'); values.push(dept_id); }
        if (prof_id !== undefined) { fields.push('prof_id = ?'); values.push(prof_id); }
        if (purpose !== undefined) { fields.push('purpose = ?'); values.push(purpose); }
        if (fields.length === 0) return res.status(400).json({ message: 'No fields provided to update' });
        values.push(id);
        const [result] = await db.execute(`UPDATE office_visits SET ${fields.join(', ')} WHERE id = ?`, values);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Visit not found' });
        res.json({ message: 'Visit updated', id });
    } catch (err) {
        console.error('Error updating office_visit:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/office_visits/:id - delete a visit
app.delete('/api/office_visits/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Visit id is required' });
    try {
        const [result] = await db.execute('DELETE FROM office_visits WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Visit not found' });
        res.json({ message: 'Visit deleted', id });
    } catch (err) {
        console.error('Error deleting office_visit:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/office_visits/scan', async (req, res) => {
    const { visitorsID, dept_id } = req.body;
    console.log('Scanner received:', { visitorsID, dept_id });
    if (!visitorsID || !dept_id) {
        return res.status(400).json({ message: 'visitorsID and dept_id are required' });
    }
    try {
        // Find latest visit for this visitorsID
        const [rows] = await db.execute('SELECT id, dept_id FROM office_visits WHERE visitorsID = ? ORDER BY createdAt DESC LIMIT 1', [visitorsID]);
        if (rows.length === 0) return res.status(404).json({ message: 'No visit found for this visitorsID' });
        const visit = rows[0];
        if (String(visit.dept_id) !== String(dept_id)) {
            return res.status(403).json({ message: 'Department mismatch' });
        }
        // Update qr_tagged to 1
        const [result] = await db.execute('UPDATE office_visits SET qr_tagged = 1 WHERE id = ?', [visit.id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Visit not found for update' });
        res.json({ message: 'QR tagged updated', id: visit.id });
    } catch (err) {
        console.error('Error in scanner qr_tagged update:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});



app.post('/api/departments', async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ message: 'Department name is required.' });
    }
    try {
        const [result] = await db.promise().execute('INSERT INTO department (dept_name) VALUES (?)', [name]);
        res.status(201).json({ message: 'Department created successfully', id: result.insertId, name });
    } catch (error) {
        console.error('Error creating department:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.delete('/api/departments/:id', async (req, res) => {
    const { id } = req.params; 
    if (!id) {
        return res.status(400).json({ message: 'Department ID is required.' });
    }
    try {
        const [result] = await db.promise().execute('DELETE FROM department WHERE id = ?', [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Department not found.' });
        }
        res.json({ message: 'Department deleted successfully', id });
    } catch (error) {
        console.error('Error deleting department:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


//api || GET /api/roles - list roles
app.get('/api/roles', async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM roles');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ---------------- service endpoints ----------------
// GET /api/services - list services (optional ?dept_id=)
app.get('/api/services', async (req, res) => {
    const { dept_id } = req.query;
    try {
        let query = 'SELECT id, srvc_name, dept_id, created_at FROM service';
        const params = [];
        if (dept_id) { query += ' WHERE dept_id = ?'; params.push(dept_id); }
        query += ' ORDER BY created_at DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /api/services/:id - get a service by id
app.get('/api/services/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Service id is required' });
    try {
        const [rows] = await db.execute('SELECT id, srvc_name, dept_id, created_at FROM service WHERE dept_id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Service not found' });
        res.json(rows[0]);
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/services - create a new service
app.post('/api/services', async (req, res) => {
    const { srvc_name, dept_id } = req.body;
    if (!srvc_name || !dept_id) {
        return res.status(400).json({ message: 'srvc_name and dept_id are required' });
    }
    try {
        const [result] = await db.execute('INSERT INTO service (srvc_name, dept_id) VALUES (?, ?)', [srvc_name, dept_id]);
        res.status(201).json({ message: 'Service created', id: result.insertId });
    } catch (error) {
        console.error('Error creating service:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// PUT /api/services/:id - update a service
app.put('/api/services/:id', async (req, res) => {
    const { id } = req.params;
    const { srvc_name, dept_id } = req.body;
    if (!id) return res.status(400).json({ message: 'Service id is required' });
    try {
        const fields = [];
        const values = [];
        if (srvc_name !== undefined) { fields.push('srvc_name = ?'); values.push(srvc_name); }
        if (dept_id !== undefined) { fields.push('dept_id = ?'); values.push(dept_id); }
        if (fields.length === 0) return res.status(400).json({ message: 'No fields provided to update' });
        values.push(id);
        const [result] = await db.execute(`UPDATE service SET ${fields.join(', ')} WHERE id = ?`, values);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Service not found' });
        res.json({ message: 'Service updated', id });
    } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// DELETE /api/services/:id - delete a service
app.delete('/api/services/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Service id is required' });
    try {
        const [result] = await db.execute('DELETE FROM service WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Service not found' });
        res.json({ message: 'Service deleted', id });
    } catch (error) {
        console.error('Error deleting service:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});





