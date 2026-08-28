-- Active: 1782974485704@@127.0.0.1@3306@roster
-- =========================================================
-- Roster database schema (MySQL 8+)
-- Run:  mysql -u root -p < schema.sql
-- =========================================================

CREATE DATABASE IF NOT EXISTS roster
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  
USE roster;

-- ---------------------------------------------------------
-- Users (recruiters / hiring managers who log in)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- Candidates
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidates (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  added_by_user_id  INT NULL,
  name              VARCHAR(255) NOT NULL,
  role              ENUM('ENG','DES','PM','DAT','MKT','OPS') NOT NULL,
  years_experience  INT NOT NULL DEFAULT 0,
  location          VARCHAR(255) DEFAULT '',
  availability      ENUM('available','open','booked') NOT NULL DEFAULT 'open',
  bio               TEXT,
  email             VARCHAR(255),
  phone             VARCHAR(50),
  linkedin          VARCHAR(255),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (added_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_role (role),
  INDEX idx_availability (availability),
  INDEX idx_years (years_experience),
  FULLTEXT INDEX idx_bio_search (name, bio, location)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- Skills (normalized so "React" is one row, reused by many candidates)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  name  VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- Candidate <-> Skill (many-to-many, with a proficiency level)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS candidate_skills (
  candidate_id  INT NOT NULL,
  skill_id      INT NOT NULL,
  level         TINYINT NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 5),
  PRIMARY KEY (candidate_id, skill_id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- Résumés — one candidate can have several uploaded over time;
-- the file itself lives on disk (see server.js UPLOAD_DIR),
-- this table remembers where it is plus what we read out of it.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS resumes (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  candidate_id      INT NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename   VARCHAR(255) NOT NULL,   -- unique name on disk in /uploads
  file_size_bytes   INT,
  extracted_text    MEDIUMTEXT,              -- full text pulled from the PDF
  extracted_email   VARCHAR(255),
  extracted_phone   VARCHAR(50),
  uploaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------
-- Saved searches (advanced-search filter presets, per user)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_searches (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  filters     JSON NOT NULL,   -- { query, roles, avail, minYears, maxYears, location, skills, minLevel }
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS face_encodings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  encoding JSON NOT NULL,   -- list of 128 floats as JSON array
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY (user_id)
) ENGINE=InnoDB;