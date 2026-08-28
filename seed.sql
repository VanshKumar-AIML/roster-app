-- Active: 1782974485704@@127.0.0.1@3306@roster
-- =========================================================
-- Sample data. Run after schema.sql:
--   mysql -u root -p roster < seed.sql
-- =========================================================
USE roster;

INSERT INTO skills (name) VALUES
  ('TypeScript'),('React'),('Node.js'),('Postgres'),('AWS'),
  ('Figma'),('Prototyping'),('Design systems'),('Motion'),
  ('Roadmapping'),('User research'),('SQL'),('A/B testing'),
  ('Python'),('dbt'),('Statistics'),('Airflow'),
  ('Lifecycle'),('Copywriting'),('SEO'),('Analytics'),
  ('Finance ops'),('Hiring'),('Vendor mgmt'),('Process design'),
  ('Go'),('Kubernetes'),('Systems design'),
  ('Illustration'),('Branding'),
  ('GraphQL'),('CSS'),('Tableau')
ON DUPLICATE KEY UPDATE name = name;

INSERT INTO candidates (name, role, years_experience, location, availability, bio, email, phone, linkedin) VALUES
('Naomi Reyes','ENG',6,'Austin, TX','available','Full-stack engineer who likes owning a feature end to end — from schema design to the pixel-level polish on release day.','naomi.reyes@example.com','+1 512 555 0148','linkedin.com/in/naomireyes'),
('Theo Bracken','DES',4,'Remote (GMT)','open','Product designer with a systems bent — most recently rebuilt a design system used across four teams.','theo.bracken@example.com','+44 7700 900112','linkedin.com/in/theobracken'),
('Priya Nathan','PM',7,'Toronto, CA','booked','Product manager who came up through support and research before switching sides.','priya.nathan@example.com','+1 416 555 0199','linkedin.com/in/priyanathan'),
('Marcus Webb','DAT',5,'Chicago, IL','available','Analytics engineer focused on making messy pipelines boring and reliable.','marcus.webb@example.com','+1 312 555 0173','linkedin.com/in/marcuswebb'),
('Sofia Marchetti','MKT',3,'Lisbon, PT','available','Growth marketer who writes her own copy and reads her own dashboards.','sofia.marchetti@example.com','+351 912 345 678','linkedin.com/in/sofiamarchetti'),
('Daniel Okafor','OPS',8,'Lagos, NG','open','Ops generalist who has built the finance-and-people function twice from scratch.','daniel.okafor@example.com','+234 803 555 0142','linkedin.com/in/danielokafor'),
('Elena Kruse','ENG',9,'Berlin, DE','booked','Infrastructure engineer, ex-team lead. Cares a lot about on-call quality of life.','elena.kruse@example.com','+49 30 5550 1122','linkedin.com/in/elenakruse'),
('Yusuf Demir','DES',2,'Remote (CET)','available','Early-career visual designer with a strong brand eye.','yusuf.demir@example.com','+90 532 555 0187','linkedin.com/in/yusufdemir'),
('Grace Whitfield','PM',4,'Seattle, WA','available','PM with a research background — spends more time watching users than writing tickets.','grace.whitfield@example.com','+1 206 555 0134','linkedin.com/in/gracewhitfield');

-- candidate_skills — matched by name lookups so ids don't need to be hardcoded
INSERT INTO candidate_skills (candidate_id, skill_id, level)
SELECT c.id, s.id, v.level FROM (
  SELECT 'Naomi Reyes' AS name, 'TypeScript' AS skill, 5 AS level UNION ALL
  SELECT 'Naomi Reyes','React',5 UNION ALL
  SELECT 'Naomi Reyes','Node.js',4 UNION ALL
  SELECT 'Naomi Reyes','Postgres',3 UNION ALL
  SELECT 'Naomi Reyes','AWS',3 UNION ALL
  SELECT 'Theo Bracken','Figma',5 UNION ALL
  SELECT 'Theo Bracken','Prototyping',4 UNION ALL
  SELECT 'Theo Bracken','Design systems',5 UNION ALL
  SELECT 'Theo Bracken','Motion',3 UNION ALL
  SELECT 'Priya Nathan','Roadmapping',5 UNION ALL
  SELECT 'Priya Nathan','User research',4 UNION ALL
  SELECT 'Priya Nathan','SQL',3 UNION ALL
  SELECT 'Priya Nathan','A/B testing',4 UNION ALL
  SELECT 'Marcus Webb','Python',5 UNION ALL
  SELECT 'Marcus Webb','SQL',5 UNION ALL
  SELECT 'Marcus Webb','dbt',4 UNION ALL
  SELECT 'Marcus Webb','Statistics',4 UNION ALL
  SELECT 'Marcus Webb','Airflow',3 UNION ALL
  SELECT 'Sofia Marchetti','Lifecycle',4 UNION ALL
  SELECT 'Sofia Marchetti','Copywriting',5 UNION ALL
  SELECT 'Sofia Marchetti','SEO',3 UNION ALL
  SELECT 'Sofia Marchetti','Analytics',3 UNION ALL
  SELECT 'Daniel Okafor','Finance ops',5 UNION ALL
  SELECT 'Daniel Okafor','Hiring',4 UNION ALL
  SELECT 'Daniel Okafor','Vendor mgmt',4 UNION ALL
  SELECT 'Daniel Okafor','Process design',5 UNION ALL
  SELECT 'Elena Kruse','Go',5 UNION ALL
  SELECT 'Elena Kruse','Kubernetes',5 UNION ALL
  SELECT 'Elena Kruse','Systems design',5 UNION ALL
  SELECT 'Elena Kruse','Postgres',4 UNION ALL
  SELECT 'Yusuf Demir','Figma',4 UNION ALL
  SELECT 'Yusuf Demir','Illustration',5 UNION ALL
  SELECT 'Yusuf Demir','Branding',4 UNION ALL
  SELECT 'Grace Whitfield','Roadmapping',4 UNION ALL
  SELECT 'Grace Whitfield','User research',5 UNION ALL
  SELECT 'Grace Whitfield','Figma',3 UNION ALL
  SELECT 'Grace Whitfield','SQL',3
) v
JOIN candidates c ON c.name = v.name
JOIN skills s ON s.name = v.skill;

-- Demo login: demo@roster.app / roster123
-- (this hash was generated with bcryptjs specifically for "roster123" —
--  regenerate it with `node -e "console.log(require('bcryptjs').hashSync('yourpassword',10))"` if you change the password)
INSERT INTO users (name, email, password_hash) VALUES
('Demo Recruiter', 'demo@roster.app', '$2b$10$WT8/CNJmMJHPjiyp0jQicOx22c1hmxZ/OKYarFdsf5gk.Ioblu5lq')
ON DUPLICATE KEY UPDATE name = name;