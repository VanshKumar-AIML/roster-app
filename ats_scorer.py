import sys
import json
import re
import traceback
import os

# Try to import sklearn and joblib, but if they fail, we'll use fallback
try:
    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False

# Try to load model files
MODEL_LOADED = False
if ML_AVAILABLE:
    try:
        model = joblib.load('ats_model.pkl')
        vectorizer = joblib.load('tfidf_vectorizer.pkl')
        MODEL_LOADED = True
    except:
        pass

def calculate_score(job_desc, resume_text):
    # Keyword overlap (always computed)
    job_words = set(re.findall(r'\b[a-zA-Z]{2,}\b', job_desc.lower()))
    resume_words = set(re.findall(r'\b[a-zA-Z]{2,}\b', resume_text.lower()))
    matched = job_words.intersection(resume_words)
    missing = job_words - resume_words
    keyword_score = (len(matched) / len(job_words)) * 100 if job_words else 0

    # If ML model loaded, blend with it
    if MODEL_LOADED:
        try:
            combined = job_desc + " " + resume_text
            vec = vectorizer.transform([combined])
            prob = model.predict_proba(vec)[0][1]
            ml_score = prob * 100
            final_score = 0.6 * ml_score + 0.4 * keyword_score
        except:
            final_score = keyword_score
    else:
        final_score = keyword_score

    return {
        "matchScore": round(min(100, max(0, final_score)), 2),
        "matchedSkills": list(matched)[:10],
        "missingSkills": list(missing)[:10],
        "keywordOverlap": round(keyword_score, 2),
        "mlAvailable": MODEL_LOADED,
        "error": None
    }

if __name__ == "__main__":
    try:
        # Read input from command line arguments
        if len(sys.argv) < 2:
            # No input provided – return default
            print(json.dumps({"error": "No input provided", "matchScore": 0}))
            sys.exit(0)

        input_data = json.loads(sys.argv[1])
        job_desc = input_data.get('jobDescription', '')
        resume_text = input_data.get('resumeText', '')

        # If either is empty, return 0
        if not job_desc or not resume_text:
            print(json.dumps({"error": "Job description or resume text empty", "matchScore": 0}))
            sys.exit(0)

        result = calculate_score(job_desc, resume_text)
        print(json.dumps(result))

    except json.JSONDecodeError as e:
        print(json.dumps({"error": "Invalid JSON input: " + str(e), "matchScore": 0}))
    except Exception as e:
        # Catch all other errors and return a fallback
        error_msg = traceback.format_exc()
        print(json.dumps({"error": "Scoring error: " + str(e), "matchScore": 0}))