const express = require('express');
const db = require('./db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
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
        purpose_of_visit,
        faculty_to_visit,
        address,
        phone
    } = req.body;

    try {
        const [result] = await db.execute(
            'INSERT INTO visitorsdata (visitorsID, first_name, middle_name, last_name, suffix, gender, birth_date, purpose_of_visit, faculty_to_visit, address, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                visitorsID ?? null,
                first_name ?? null,
                middle_name ?? null,
                last_name ?? null,
                suffix ?? null,
                gender ?? null,
                birth_date ?? null,
                purpose_of_visit ?? null,
                JSON.stringify(faculty_to_visit ?? []),
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
    const now = new Date();
    const timeOut = now.toTimeString().split(' ')[0];
    try {
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
        const [rows] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }
        const user = rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid username or password.' });
        }
        const adminToken = crypto.randomBytes(32).toString('hex');
        await db.execute('UPDATE users SET token = ? WHERE id = ?', [adminToken, user.id]);
        const { password: _, ...userWithoutPassword } = user;
        res.json({ message: 'Login successful', user: { ...userWithoutPassword, adminToken } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

app.post('/api/logout', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ message: 'Username is required.' });
    }
    try {
        await db.execute('UPDATE users SET token = NULL WHERE username = ?', [username]);
        res.json({ message: 'Logout successful' });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

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
            'SELECT * FROM professors WHERE department = ? ORDER BY createdAt DESC',
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
// Create user
app.post('/api/users', async (req, res) => {
    const { username, email, phone, password, dept_id } = req.body;
    if (!username || !email || !phone || !password) {
        return res.status(400).json({ message: 'username, email, phone and password are required' });
    }
    try {
        const hashed = await bcrypt.hash(password, 10);
        const [result] = await db.execute(
            'INSERT INTO users (username, email, phone, password, dept_id) VALUES (?, ?, ?, ?, ?)',
            [username, email, phone, hashed, dept_id || null]
        );
        res.status(201).json({ message: 'User created', id: result.insertId });
    } catch (err) {
        console.error('Error creating user:', err);
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'User already exists' });
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Update user
app.put('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    const { username, email, phone, password, dept_id } = req.body;
    if (!id) return res.status(400).json({ message: 'User id is required' });
    try {
        const fields = [];
        const values = [];
        if (username !== undefined) { fields.push('username = ?'); values.push(username); }
        if (email !== undefined) { fields.push('email = ?'); values.push(email); }
        if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
        if (dept_id !== undefined) { fields.push('dept_id = ?'); values.push(dept_id); }
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
        let query = 'SELECT id, username, email, phone, dept_id, token, createdAt FROM users';
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
        const [rows] = await db.execute('SELECT id, username, email, phone, dept_id, token, createdAt FROM users WHERE id = ?', [id]);
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
    const { visitorsID, dept_id, prof_id } = req.query;
    try {
        let query = 'SELECT * FROM office_visits';
        const clauses = [];
        const params = [];
        if (visitorsID) { clauses.push('visitorsID = ?'); params.push(visitorsID); }
        if (dept_id) { clauses.push('dept_id = ?'); params.push(dept_id); }
        if (prof_id) { clauses.push('prof_id = ?'); params.push(prof_id); }
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
        const [rows] = await db.execute('SELECT * FROM office_visits WHERE id = ?', [id]);
        if (rows.length === 0) return res.status(404).json({ message: 'Visit not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Error fetching office_visit:', err);
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

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});





