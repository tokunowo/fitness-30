GymVerge Workout — Firebase Cloud Sync Upgrade
==================================================

READY FOR:
• workout.gymverge.com
• GitHub Pages
• Firebase Authentication (Email/Password)
• Cloud Firestore
• Existing browser localStorage preserved

UPLOAD
------
Replace the existing files in the GitHub fitness-30 repository with ALL files
from this package.

REQUIRED FIREBASE SETUP
-----------------------
1. Authentication → Email/Password enabled.
2. Authorized domains include:
   workout.gymverge.com
   tokunowo.github.io
3. Firestore database created.
4. Firestore rules published:

rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }

    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
  }
}

HOW SAVING WORKS
----------------
• Not signed in: original localStorage behavior continues.
• Signed in: localStorage remains active AND progress syncs to Firestore.
• First sign-in migrates/merges existing local progress into the cloud.
• Same Firebase account on another authorized device/domain loads cloud progress.

IMPORTANT
---------
Use workout.gymverge.com consistently after HTTPS is available.
The Firebase web API key is intentionally public client configuration.
Firestore Security Rules protect the actual workout data.
