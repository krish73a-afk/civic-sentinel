
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pathlib import Path
import mimetypes

load_dotenv()

client = genai.Client()

# Load the image
image_path = Path("test_photo.jpg")

if not image_path.exists():
    print("ERROR: test_photo.jpg not found!")
    raise SystemExit

image_bytes = image_path.read_bytes()
mime_type = mimetypes.guess_type(image_path)[0]

print("Image loaded successfully!")
print("Sending image to Gemini...")

try:
    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents=[
           
"""You are Civic Sentinel, an AI civic issue detector.

Analyze the uploaded photograph and return JSON
containing exactly these five fields:

1. problem
2. category
3. visible_evidence
4. suggested_action
5. priority

IMPORTANT RULES:

CATEGORY must be exactly one of:
ROAD, WASTE, TRAFFIC, STREETLIGHT,
DRAINAGE, PEDESTRIAN, CYCLING, OTHER

PRIORITY must be exactly one of:
LOW, MEDIUM, HIGH

Estimate priority based only on visible evidence.
If the image is unclear, explain the uncertainty.
Never invent information.

Return all five fields in JSON format.
"""
,
            types.Part.from_bytes(
                data=image_bytes,
                mime_type=mime_type
            )
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )

    print("\nCIVIC SENTINEL ANALYSIS:")
    print(response.text)

except Exception as e:
    print("ERROR:", e)
