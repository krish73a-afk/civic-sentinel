# Firebase and authentication setup

## Firestore and backend credentials

1. Create or select your project in the [Firebase console](https://console.firebase.google.com/).
2. Create a Firestore database in production mode.
3. Under **Project settings → Service accounts**, obtain a service-account JSON credential. Store it outside the repository and never place it in `frontend`.
4. Copy `backend/.env.example` to `backend/.env` and set:

   ```dotenv
   GEMINI_API_KEY=your_gemini_api_key
   FIREBASE_PROJECT_ID=your_project_id
   GOOGLE_APPLICATION_CREDENTIALS=C:/private-credentials/service-account.json
   ```

5. Install the requirements and start the backend using the README instructions.

The backend uses the Firebase Admin SDK and the service account's IAM permissions. The browser does not access Firestore directly. Keep client Firestore rules closed unless you deliberately add a client-access feature.

## Google sign-in

1. Register a Firebase web app under **Project settings**.
2. Under **Authentication → Sign-in method**, enable Google and select your project's support email.
3. Under **Authentication → Settings → Authorized domains**, add `localhost` for development and the exact frontend domain for a deployment.
4. Add your web app's public configuration to the local `.env`:

   ```dotenv
   CIVIC_AUTH_MODE=firebase
   FIREBASE_WEB_API_KEY=your_firebase_web_api_key
   FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   FIREBASE_WEB_APP_ID=your_web_app_id
   CIVIC_ALLOWED_ORIGINS=http://127.0.0.1:5500,http://localhost:5500
   CIVIC_LOCAL_MODE_SWITCH=0
   ```

5. Restart the backend, open `http://localhost:5500/`, and select **Continue with Google**.
6. For administrator permissions, copy your own UID from **Firebase Authentication → Users** into `CIVIC_ADMIN_UIDS` in `.env`, then restart. Separate multiple UIDs with commas. Use UIDs rather than email addresses.

The backend verifies Firebase ID tokens with revocation checks. Signed-in users can view community reports and photos; the creator or an administrator can edit a report's status or replace its photo. Existing reports without a verified creator require an administrator to edit them.

## Optional local presentation mode

For a presentation on your own computer, set `CIVIC_AUTH_MODE=local_demo` and restart the backend. Bind it to `127.0.0.1`. Google sign-in controls are hidden in this mode.

To use the Windows shortcuts without restarting each time, set `CIVIC_LOCAL_MODE_SWITCH=1` and restart once. Then run **Enable Authentication.cmd** or **Enable Demo Mode.cmd**, and refresh the frontend. The shortcuts create a local ignored `.auth-mode` file. They do not change Firebase provider settings or delete reports.

For a shared deployment, use `CIVIC_AUTH_MODE=firebase` and `CIVIC_LOCAL_MODE_SWITCH=0`, HTTPS, managed credentials, and persistent photo storage.

## Evidence storage and troubleshooting

Firestore holds incident fields and photo references. JPEG evidence files live in `backend/uploads`, created on demand and ignored by Git. Back up that folder separately when moving a running installation.

- **Backend unavailable:** confirm port 8000 is running, then reload the frontend.
- **Could not load reports:** verify the project ID, credential path, IAM permissions, and internet connection.
- **Sign-in domain error:** add the exact frontend hostname to Firebase's authorized domains.
- **Analysis succeeded but saving failed:** use the report or evidence retry action after restoring connectivity or storage permissions.
- **Gemini request failed:** verify your key's access to the model configured in `main.py` and available quota.
