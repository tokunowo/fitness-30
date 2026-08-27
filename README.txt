GymVerge Workout — Live Timer + Adjustable Interval Timer

NO PROGRESS RESET
• Keeps localStorage key: tosinFitness30.v1
• Keeps Firebase path: /users/{uid}/fitness30/progress
• Existing completed days/checkmarks/notes remain.

NEW
• Start/Pause/Resume workout session timer.
• Timestamp based: accurate after switching apps, locking phone, refresh, or returning later.
• Complete Day automatically stops and saves duration.
• Adjustable interval timer: custom labels, minutes, seconds, and transition countdown.
• 3-second transition countdown by default.
• Automatic Run/Walk presets for Days 2, 9, 16, 23, and 30.
• Back / Skip / Pause / Resume / Reset controls.
• Timer and interval state sync through existing Firebase progress document.
• Progress page shows total and average timed workout duration.

UPLOAD
Replace all files in the fitness-30 GitHub repository.
Suggested commit: Add live workout and interval timers

After GitHub deploys, hard refresh once or close/reopen the mobile browser tab.


DIFFICULTY GAUGE UPDATE
-----------------------
• Adds a 5-level tap gauge: Very Easy / Easy / Moderate / Hard / Very Hard.
• Difficulty saves inside the existing day progress object in localStorage and Firebase.
• Existing progress is preserved because the same localStorage key and Firestore document path remain unchanged.
• Existing legacy 1–10 "feel" values are not deleted.
• Notes are now optional under "Add optional note".
• Progress page shows average, hardest, and easiest difficulty ratings.
• Service worker cache bumped to v7.
