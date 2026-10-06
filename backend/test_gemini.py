from dotenv import load_dotenv
import os

print("1. Starting test...")

load_dotenv()

print("2. .env loaded")

key = os.getenv("GEMINI_API_KEY")

if not key:
    print("3. ERROR: GEMINI_API_KEY was not found")
    raise SystemExit

print("3. API key found")

from google import genai

print("4. google-genai imported")

client = genai.Client(api_key=key)

print("5. Gemini client created")

try:
    response = client.models.generate_content(
        model="gemini-3.5-flash-lite",
        contents="Reply with exactly: Civic Sentinel AI is online."
    )

    print("6. Gemini responded")
    print("RESPONSE:")
    print(response.text)

except Exception as e:
    print("ERROR FROM GEMINI:")
    print(type(e).__name__)
    print(e)