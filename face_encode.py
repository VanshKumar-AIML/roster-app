import sys
import json
import base64
import numpy as np
import cv2
from deepface import DeepFace

def get_encoding(image_base64):
    try:
        # Decode base64 to image
        img_data = base64.b64decode(image_base64)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        # Get embedding
        embedding = DeepFace.represent(img, model_name='Facenet', enforce_detection=False)
        if isinstance(embedding, list) and len(embedding) > 0:
            return embedding[0]['embedding'] if isinstance(embedding[0], dict) else embedding[0]
        return None
    except Exception as e:
        return None

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.argv[1])
        image_base64 = input_data.get('image_base64', '')
        encoding = get_encoding(image_base64)
        if encoding is not None:
            print(json.dumps({"encoding": encoding}))
        else:
            print(json.dumps({"error": "No face detected", "encoding": None}))
    except Exception as e:
        print(json.dumps({"error": str(e), "encoding": None}))