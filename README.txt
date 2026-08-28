GymVerge Workout — FINAL CONSOLIDATED v10

Includes all updates made so far:
- Original 30-day plan and saved exercise progress
- Firebase cloud sync
- Live timestamp-based workout stopwatch
- Workout time history/progress
- Adjustable multi-step interval timer
- Run/walk presets
- Draft interval editing with OK — SAVE INTERVALS and Cancel
- 3-second adjustable transition countdown
- Interval sound cues and GO sound
- Supported-device vibration cues
- Sound/vibration toggles
- 5-level workout difficulty gauge
- Optional notes
- Difficulty progress statistics
- Workout-complete Congratulations screen with fireworks/confetti, success sound and supported vibration

DATA SAFETY:
The existing localStorage key remains tosinFitness30.v1 and Firebase configuration/path remain unchanged.
This update is designed to preserve existing completed days, checkmarks, notes, timers and ratings.

Deploy all files in this ZIP over the existing GitHub repository files, then hard-refresh/reopen the site once.
Service worker cache: fitness30-v10.

Mobile note: timestamp timers remain accurate across browser suspension. Sound/vibration while fully backgrounded or phone-locked remain subject to mobile browser/OS restrictions.


v11 EMERGENCY FIX
-----------------
This release fixes the regression visible after the v10 upload:
• Today content no longer goes blank.
• Fixes ReferenceError caused by interval editor using an undefined `draft`.
• Interval editor now reads the draft configuration correctly.
• Difficulty ratings have a real migration-safe default and label helper.
• Keeps one reliable global difficulty click handler.
• Interval sound/vibration cue checker is now wired into the live timer tick.
• Sound/vibration defaults are preserved on existing saved days.
• Firestore/UI errors are separated so a render error is not falsely labeled as a cloud-sync failure.
• Firebase errors now show their actual error code when one truly occurs.
• Asset URLs are versioned and service-worker cache is bumped to v11.
• Existing localStorage key remains exactly `tosinFitness30.v1`.
