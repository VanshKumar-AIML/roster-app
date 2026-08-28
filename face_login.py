import sys
import json
import base64
import numpy as np
import cv2
from deepface import DeepFace
from scipy.spatial.distance import cosine

def verify_face(image_base64, stored_encodings):
    try:
        # Decode image
        img_data = base64.b64decode(image_base64)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # Get embedding of uploaded face
        embedding = DeepFace.represent(img, model_name='Facenet', enforce_detection=False)
        if not embedding:
            return None
        emb = embedding[0]['embedding'] if isinstance(embedding[0], dict) else embedding[0]

        # Compare with stored encodings
        best_user_id = None
        best_distance = float('inf')
        for user_id, stored_emb in stored_encodings:
            distance = cosine(emb, stored_emb)
            if distance < 0.4 and distance < best_distance:  # threshold
                best_distance = distance
                best_user_id = user_id

        return best_user_id
    except Exception as e:
        return None

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.argv[1])
        image_base64 = input_data.get('image_base64', '')
        encodings = input_data.get('encodings', [])  # list of [user_id, encoding]
        user_id = verify_face(image_base64, encodings)
        if user_id is not None:
            print(json.dumps({"user_id": user_id}))
        else:
            print(json.dumps({"error": "Face not recognised", "user_id": None}))
    except Exception as e:
        print(json.dumps({"error": str(e), "user_id": None}))