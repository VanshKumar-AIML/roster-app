require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PythonShell } = require('python-shell');

// ---------- Fallback keyword scorer (pure JS) ----------
function keywordScore(jobDesc, resumeText) {
  const jobWords = new Set((jobDesc || '').toLowerCase().match(/\b[a-zA-Z]{2,}\b/g) || []);
  const resumeWords = new Set((resumeText || '').toLowerCase().match(/\b[a-zA-Z]{2,}\b/g) || []);
  if (jobWords.size === 0) return 0;
  const matched = [...jobWords].filter(w => resumeWords.has(w));
  return Math.round((matched.length / jobWords.size) * 100);
}

// ---------- PDF extraction (dynamic import) ----------
async function extractPdfText(buffer) {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    return text;
  } catch (err) {
    console.warn('PDF extraction failed:', err.message);
    return '';
  }
}

// ---------- Python script runner with fallback ----------
// BUGFIX: PythonShell was not given a scriptPath, so it looked for the
// scripts relative to process.cwd() instead of this file's directory.
// That made every Python call silently fall back unless you happened to
// launch `node server.js` from inside this exact folder.
function pythonScriptExists(scriptName) {
  const fullPath = path.join(__dirname, scriptName);
  return fs.existsSync(fullPath);
}

async function runPythonScript(scriptName, args, fallback) {
  if (!pythonScriptExists(scriptName)) {
    console.warn(`Python script ${scriptName} not found – using fallback.`);
    return fallback;
  }

  const options = {
    mode: 'text',
    pythonOptions: ['-u'],
    scriptPath: __dirname, // <-- the fix
    args: [JSON.stringify(args)],
    // If you use a virtualenv, point this at its interpreter, e.g.:
    // pythonPath: path.join(__dirname, 'venv', 'bin', 'python')
    pythonPath: process.env.PYTHON_PATH || undefined,
  };

  try {
    const results = await new Promise((resolve, reject) => {
      PythonShell.run(scriptName, options, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
    if (!results || results.length === 0) throw new Error('No output from Python script');
    return JSON.parse(results[results.length - 1]);
  } catch (err) {
    console.warn(`Python script ${scriptName} failed:`, err.message);
    return fallback;
  }
}

// ---------- Express app ----------
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
// Serving the frontend from this same Express app (see the static block
// near the bottom) means the browser sees frontend + API on one origin,
// so CORS/cookies "just work" without extra configuration. CORS is still
// enabled here in case you want to run the frontend from a separate dev
// server/port.
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || true,
  credentials: true
}));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- MySQL connection pool ----------
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'roster',
  waitForConnections: true,
  connectionLimit: 10,
});

// ---------- Auth helpers ----------
function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const token = req.cookies.roster_token;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please log in again.' });
  }
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
const CLEAR_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
};

// Helper: turn a resumes row into a public URL
function resumeUrlFor(storedFilename) {
  return storedFilename ? `/uploads/${storedFilename}` : null;
}

// ======================== AUTH ROUTES ========================
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length) return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name.trim(), email.toLowerCase(), hash]
    );
    const user = { id: result.insertId, name: name.trim(), email: email.toLowerCase() };
    res.cookie('roster_token', signToken(user), COOKIE_OPTS);
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'That email and password don’t match anything on file.' });

    const match = await bcrypt.compare(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'That email and password don’t match anything on file.' });

    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email };
    res.cookie('roster_token', signToken(user), COOKIE_OPTS);
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('roster_token', CLEAR_COOKIE_OPTS);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ======================== CANDIDATES CRUD ========================
app.get('/api/candidates', async (req, res) => {
  try {
    const { query, role, availability, minYears, maxYears, location, skills, minLevel, sort } = req.query;

    let sql = `
      SELECT c.*,
        (SELECT r.id FROM resumes r WHERE r.candidate_id = c.id ORDER BY r.uploaded_at DESC LIMIT 1) AS latest_resume_id,
        (SELECT r.stored_filename FROM resumes r WHERE r.candidate_id = c.id ORDER BY r.uploaded_at DESC LIMIT 1) AS latest_resume_file
      FROM candidates c
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      const roles = role.split(',').filter(Boolean);
      sql += ` AND c.role IN (${roles.map(() => '?').join(',')})`;
      params.push(...roles);
    }
    if (availability) {
      const avails = availability.split(',').filter(Boolean);
      sql += ` AND c.availability IN (${avails.map(() => '?').join(',')})`;
      params.push(...avails);
    }
    if (minYears) { sql += ` AND c.years_experience >= ?`; params.push(Number(minYears)); }
    if (maxYears) { sql += ` AND c.years_experience <= ?`; params.push(Number(maxYears)); }
    if (location) { sql += ` AND c.location LIKE ?`; params.push(`%${location}%`); }
    if (query) {
      sql += ` AND (c.name LIKE ? OR c.bio LIKE ? OR c.location LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (skills) {
      const skillList = skills.split(',').filter(Boolean);
      sql += `
        AND c.id IN (
          SELECT cs.candidate_id FROM candidate_skills cs
          JOIN skills s ON s.id = cs.skill_id
          WHERE s.name IN (${skillList.map(() => '?').join(',')})
          ${minLevel ? 'AND cs.level >= ?' : ''}
          GROUP BY cs.candidate_id
          HAVING COUNT(DISTINCT s.name) = ?
        )
      `;
      params.push(...skillList);
      if (minLevel) params.push(Number(minLevel));
      params.push(skillList.length);
    } else if (minLevel) {
      sql += ` AND c.id IN (SELECT candidate_id FROM candidate_skills WHERE level >= ?)`;
      params.push(Number(minLevel));
    }

    if (sort === 'exp_desc') sql += ' ORDER BY c.years_experience DESC';
    else if (sort === 'exp_asc') sql += ' ORDER BY c.years_experience ASC';
    else if (sort === 'name') sql += ' ORDER BY c.name ASC';
    else sql += ' ORDER BY c.created_at DESC';

    const [candidates] = await pool.query(sql, params);
    if (!candidates.length) return res.json({ candidates: [] });

    const ids = candidates.map(c => c.id);
    const [skillRows] = await pool.query(
      `SELECT cs.candidate_id, s.name, cs.level FROM candidate_skills cs
       JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const skillsByCandidate = {};
    skillRows.forEach(r => {
      (skillsByCandidate[r.candidate_id] ||= []).push({ name: r.name, level: r.level });
    });

    res.json({
      // BUGFIX: previously `resume_url` was never populated, so the
      // frontend always showed "No résumé on file yet." even after an
      // upload. It's now derived from the candidate's latest resume row.
      candidates: candidates.map(c => ({
        ...c,
        skills: skillsByCandidate[c.id] || [],
        resume_url: resumeUrlFor(c.latest_resume_file),
        latest_resume_file: undefined,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load candidates.' });
  }
});

app.get('/api/candidates/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM candidates WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Candidate not found.' });
    const [skillRows] = await pool.query(
      `SELECT s.name, cs.level FROM candidate_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id = ?`,
      [req.params.id]
    );
    const [resumeRows] = await pool.query(
      `SELECT id, original_filename, stored_filename, uploaded_at FROM resumes WHERE candidate_id = ? ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    const latest = resumeRows[0];
    res.json({
      candidate: {
        ...rows[0],
        skills: skillRows,
        resumes: resumeRows.map(r => ({ ...r, fileUrl: resumeUrlFor(r.stored_filename) })),
        resume_url: latest ? resumeUrlFor(latest.stored_filename) : null,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load candidate.' });
  }
});

app.post('/api/candidates', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { name, role, years, location, availability, bio, email, phone, linkedin, skills } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'Name and role are required.' });

    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO candidates (added_by_user_id, name, role, years_experience, location, availability, bio, email, phone, linkedin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, name, role, years || 0, location || '', availability || 'open', bio || '', email || '', phone || '', linkedin || '']
    );
    const candidateId = result.insertId;

    for (const skill of (skills || [])) {
      const skillName = (skill.name || skill.n || '').trim();
      if (!skillName) continue;
      await conn.query('INSERT INTO skills (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name', [skillName]);
      const [[skillRow]] = await conn.query('SELECT id FROM skills WHERE name = ?', [skillName]);
      await conn.query('INSERT INTO candidate_skills (candidate_id, skill_id, level) VALUES (?, ?, ?)', [
        candidateId, skillRow.id, skill.level || skill.l || 3,
      ]);
    }

    await conn.commit();
    res.status(201).json({ id: candidateId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Could not add candidate.' });
  } finally {
    conn.release();
  }
});

app.patch('/api/candidates/:id', requireAuth, async (req, res) => {
  try {
    const fields = ['name', 'role', 'years_experience', 'location', 'availability', 'bio', 'email', 'phone', 'linkedin'];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(req.params.id);
    await pool.query(`UPDATE candidates SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update candidate.' });
  }
});

// ---------- Resume upload ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const unique = crypto.randomBytes(8).toString('hex');
      cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are accepted.'));
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post('/api/candidates/:id/resume', requireAuth, (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const [candidateRows] = await pool.query('SELECT id FROM candidates WHERE id = ?', [req.params.id]);
    if (!candidateRows.length) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    const buffer = fs.readFileSync(req.file.path);
    let text = await extractPdfText(buffer);

    const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const phoneMatch = text.match(/(\+?\d[\d\s\-().]{7,}\d)/);

    const [result] = await pool.query(
      `INSERT INTO resumes (candidate_id, original_filename, stored_filename, file_size_bytes, extracted_text, extracted_email, extracted_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        req.file.originalname,
        req.file.filename,
        req.file.size,
        text.slice(0, 500000),
        emailMatch ? emailMatch[0] : null,
        phoneMatch ? phoneMatch[0].trim() : null,
      ]
    );

    res.status(201).json({
      resumeId: result.insertId,
      fileUrl: resumeUrlFor(req.file.filename),
      extracted: { email: emailMatch ? emailMatch[0] : null, phone: phoneMatch ? phoneMatch[0].trim() : null },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not process résumé.' });
  }
});

app.get('/api/candidates/:id/resumes', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, original_filename, stored_filename, extracted_email, extracted_phone, uploaded_at
       FROM resumes WHERE candidate_id = ? ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    res.json({ resumes: rows.map(r => ({ ...r, fileUrl: resumeUrlFor(r.stored_filename) })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load résumés.' });
  }
});

// ---------- Saved searches ----------
app.get('/api/saved-searches', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, name, filters, created_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
  res.json({ searches: rows });
});

app.post('/api/saved-searches', requireAuth, async (req, res) => {
  const { name, filters } = req.body;
  if (!name || !filters) return res.status(400).json({ error: 'A name and filters object are required.' });
  const [result] = await pool.query('INSERT INTO saved_searches (user_id, name, filters) VALUES (?, ?, ?)', [
    req.user.id, name, JSON.stringify(filters),
  ]);
  res.status(201).json({ id: result.insertId });
});

app.delete('/api/saved-searches/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ======================== ATS SEARCH ========================
app.post('/api/candidates/ats-search', requireAuth, async (req, res) => {
  try {
    const { jobDescription, role, availability, minYears, maxYears, location, skills, minLevel } = req.body;
    if (!jobDescription) {
      return res.status(400).json({ error: 'Job description is required.' });
    }

    let sql = `
      SELECT c.*,
        (SELECT r.extracted_text FROM resumes r WHERE r.candidate_id = c.id ORDER BY r.uploaded_at DESC LIMIT 1) AS resume_text,
        (SELECT r.stored_filename FROM resumes r WHERE r.candidate_id = c.id ORDER BY r.uploaded_at DESC LIMIT 1) AS latest_resume_file
      FROM candidates c
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      const roles = role.split(',').filter(Boolean);
      sql += ` AND c.role IN (${roles.map(() => '?').join(',')})`;
      params.push(...roles);
    }
    if (availability) {
      const avails = availability.split(',').filter(Boolean);
      sql += ` AND c.availability IN (${avails.map(() => '?').join(',')})`;
      params.push(...avails);
    }
    if (minYears) { sql += ` AND c.years_experience >= ?`; params.push(Number(minYears)); }
    if (maxYears) { sql += ` AND c.years_experience <= ?`; params.push(Number(maxYears)); }
    if (location) { sql += ` AND c.location LIKE ?`; params.push(`%${location}%`); }
    if (skills) {
      const skillList = skills.split(',').filter(Boolean);
      sql += `
        AND c.id IN (
          SELECT cs.candidate_id FROM candidate_skills cs
          JOIN skills s ON s.id = cs.skill_id
          WHERE s.name IN (${skillList.map(() => '?').join(',')})
          ${minLevel ? 'AND cs.level >= ?' : ''}
          GROUP BY cs.candidate_id
          HAVING COUNT(DISTINCT s.name) = ?
        )
      `;
      params.push(...skillList);
      if (minLevel) params.push(Number(minLevel));
      params.push(skillList.length);
    } else if (minLevel) {
      sql += ` AND c.id IN (SELECT candidate_id FROM candidate_skills WHERE level >= ?)`;
      params.push(Number(minLevel));
    }

    const [candidates] = await pool.query(sql, params);
    if (!candidates.length) return res.json({ candidates: [] });

    // Score each candidate using Python if available, else fallback
    const scoredCandidates = [];
    for (const c of candidates) {
      let resumeText = c.resume_text || '';
      if (!resumeText.trim()) {
        // Build a text representation from skills and bio
        const [skillRows] = await pool.query(
          `SELECT s.name FROM candidate_skills cs JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id = ?`,
          [c.id]
        );
        const skillNames = skillRows.map(r => r.name).join(' ');
        resumeText = (c.bio || '') + ' ' + skillNames;
      }
      if (!resumeText.trim()) {
        scoredCandidates.push({ ...c, atsScore: 0 });
        continue;
      }

      let score = 0;
      // Try Python scorer, fallback to JS keyword score
      const result = await runPythonScript('ats_scorer.py', { jobDescription, resumeText }, null);
      if (result && typeof result.matchScore === 'number') {
        score = result.matchScore;
      } else {
        // Fallback to JS keyword scorer
        score = keywordScore(jobDescription, resumeText);
      }
      scoredCandidates.push({ ...c, atsScore: Math.round(score) });
    }

    scoredCandidates.sort((a, b) => b.atsScore - a.atsScore);

    const ids = scoredCandidates.map(c => c.id);
    const [skillRows] = await pool.query(
      `SELECT cs.candidate_id, s.name, cs.level FROM candidate_skills cs
       JOIN skills s ON s.id = cs.skill_id WHERE cs.candidate_id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const skillsByCandidate = {};
    skillRows.forEach(r => {
      (skillsByCandidate[r.candidate_id] ||= []).push({ name: r.name, level: r.level });
    });

    const finalCandidates = scoredCandidates.map(c => ({
      ...c,
      skills: skillsByCandidate[c.id] || [],
      resume_url: resumeUrlFor(c.latest_resume_file),
      resume_text: undefined,
      latest_resume_file: undefined,
    }));

    res.json({ candidates: finalCandidates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ATS search failed.' });
  }
});

// ======================== FACE REGISTRATION & LOGIN ========================
app.post('/api/face/register', requireAuth, async (req, res) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'Image required' });

    // Try to get encoding from Python, fallback to error if unavailable
    const result = await runPythonScript('face_encode.py', { image_base64 }, null);
    if (!result || !result.encoding) {
      return res.status(400).json({ error: (result && result.error) || 'Face encoding failed. Ensure DeepFace/OpenCV are installed in the Python venv and a face was detected.' });
    }

    await pool.query(
      `INSERT INTO face_encodings (user_id, encoding) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE encoding = VALUES(encoding)`,
      [req.user.id, JSON.stringify(result.encoding)]
    );
    res.json({ ok: true, message: 'Face registered successfully' });
  } catch (err) {
    console.error('Face registration error:', err);
    res.status(500).json({ error: 'Face registration failed: ' + err.message });
  }
});

app.post('/api/face-login', async (req, res) => {
  try {
    const { image_base64 } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'Image required' });

    // Fetch all stored encodings
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, fe.encoding
       FROM face_encodings fe
       JOIN users u ON u.id = fe.user_id`
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No face registered. Please use email/password.' });
    }

    const encodingsData = rows.map(r => [r.id, JSON.parse(r.encoding)]);

    // Run face login script
    const result = await runPythonScript('face_login.py', { image_base64, encodings: encodingsData }, null);
    if (!result || !result.user_id) {
      return res.status(401).json({ error: (result && result.error) || 'Face not recognised' });
    }

    const [[user]] = await pool.query('SELECT id, name, email FROM users WHERE id = ?', [result.user_id]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const tokenUser = { id: user.id, name: user.name, email: user.email };
    res.cookie('roster_token', signToken(tokenUser), COOKIE_OPTS);
    res.json({ user: tokenUser });
  } catch (err) {
    console.error('Face login error:', err);
    res.status(500).json({ error: 'Face login failed: ' + err.message });
  }
});

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- Serve the frontend (same-origin, so cookies + fetch just work) ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`Roster API + frontend listening on http://localhost:${PORT}`);
  console.log(`Node environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
