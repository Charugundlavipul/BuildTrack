# Mobile and offline field guide

## Install BuildTrack

Open the HTTPS development URL while online and sign in. On Android/Chrome, use the visible **Install** action when offered. On iPhone/iPad Safari, use **Share → Add to Home Screen**. Launch BuildTrack from its home-screen icon once before going to the field.

## Prepare for offline work

1. Open the required home while online.
2. Select **Download home**.
3. Wait for confirmation that the package was saved.
4. Confirm the home, its work items, and planned inspections open before disconnecting.

Downloads are isolated by signed-in user and organization and expire after 24 hours. They include only records the user could read when the package was created. Signing out removes downloaded read data. Do not share an unlocked field device.

## Work without internet

Downloaded homes, work details, conversations, evidence metadata, and inspection checklists remain readable. Users can queue new observations, camera evidence, comments, work progress commands, checklist responses, inspection findings, and inspection submission. The Sync center shows every local operation and file.

Server-derived readiness, invitations, administration, assignments, exports, scheduling, and final milestone approval require a connection because they depend on current authorization or cross-record calculations.

## Reconnect and synchronize

Open the Sync center after connectivity returns and choose **Sync now**. BuildTrack revalidates the session, organization membership, scope, record version, and upload permission before sending anything. It never replays one user's queue under another user. Conflicts and revoked access remain visible for review instead of overwriting server data.

Keep the app open until uploads and commands show `synced`. A queued item is not part of server readiness, notifications, reports, or the audit record until synchronization succeeds.
