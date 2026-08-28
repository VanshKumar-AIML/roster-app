# Roster

A candidate-roster app: MySQL + Express API, a vanilla-JS single-page frontend,
résumé PDF parsing, an ATS keyword/ML matcher, and optional face-login via DeepFace.

## Project layout

```
roster-app/
├── server.js              # Express API (also serves public/index.html)
├── public/index.html      # Frontend (SPA, hash-routed)
├── ats_scorer.py          # Résumé ↔ job-description scorer
├── face_encode.py         # Face → embedding (registration)
├── face_login.py          # Face → user match (login)
├── schema.sql             # MySQL schema
├── seed.sql               # Sample data + demo login
├── package.json
├── requirements.txt       # Python deps (face login + optional ATS ML)
├── .env.example           # Copy to .env and fill in
└── uploads/                # Created automatically; stores uploaded résumés
```

## 1. Prerequisites

- Node.js 18+
- MySQL 8+ running locally (or reachable)
- Python 3.9–3.11 in a virtual environment (you said this is already set up)

## 2. Database setup

```bash
mysql -u root -p < schema.sql
mysql -u root -p roster < seed.sql
```

This creates the `roster` database and seeds 9 sample candidates plus a demo
login: **demo@roster.app / roster123**.

## 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
- Set `DB_USER` / `DB_PASSWORD` / `DB_NAME` to match your MySQL setup.
- Set `JWT_SECRET` to any long random string.
- Set `PYTHON_PATH` to your venv's python executable, e.g.
  `/path/to/roster-app/venv/bin/python` (Linux/macOS) or
  `C:\path\to\roster-app\venv\Scripts\python.exe` (Windows).
  If you leave it blank, the system `python`/`python3` on PATH is used.

## 4. Install dependencies

**Node:**
```bash
npm install
```

**Python (inside your existing virtual environment):**
```bash
# activate your venv first, e.g.:
#   source venv/bin/activate        (Linux/macOS)
#   venv\Scripts\activate           (Windows)
pip install -r requirements.txt
```

> Face login is optional. If `deepface`/`opencv-python`/`tensorflow` aren't
> installed (or fail to import), `/api/face/register` and `/api/face-login`
> will return a clear error instead of crashing the server — everything else
> (search, filters, ATS scoring, résumé upload) works without them.
>
> The ATS scorer also works with **no Python ML libraries at all** — it falls
> back to plain keyword overlap. `scikit-learn`/`joblib` are only needed if
> you want to blend in a trained model (`ats_model.pkl` +
> `tfidf_vectorizer.pkl`, which you'd train and supply yourself — none is
> included).

## 5. Run it

```bash
npm start
```

Then open **http://localhost:3001** in your browser. The Express server
serves both the API (`/api/...`) and the frontend (`public/index.html`) from
the same origin, so login cookies work with no extra configuration.

Log in with the demo account (`demo@roster.app` / `roster123`) or register a
new one, then:
- Browse/filter/search the roster.
- Click **+ Upload résumé** to drop a PDF — it's parsed client-side for a
  name/email/phone guess, and the actual file is uploaded and stored server-side.
- Paste a job description into the **ATS /** row and click **Score & sort**
  to rank candidates by match.
- In **Account**, upload a photo to register your face; back on the login
  page you can then log in with a photo/webcam capture instead of a password.

## Notes / things to double check for production

- `NODE_ENV=production` turns on `secure` cookies, which requires HTTPS —
  don't set that until you're actually serving over TLS.
- Uploaded résumés are stored on local disk (`uploads/`); back this up or
  move it to object storage if you deploy beyond a single box.
- There's no rate limiting on `/api/login`, `/api/face-login`, or
  `/api/register` — add some (e.g. `express-rate-limit`) before exposing
  this publicly.
