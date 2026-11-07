# Live Session Simulator --- Functionality Tasks

> **Purpose:** Implement the functionality for a private, local-first
> class video simulator.
>
> **Approach:** Reuse LocalPlay for drag-and-drop and local video
> playback. Implement the simulated live-session behavior and anti-skip
> logic in our own code.
>
> **Privacy requirement:** Videos must remain local. Do not upload video
> files to a server or third-party service.

## Project Scope

### Included in this task

-   Integrate LocalPlay's drag-and-drop video selection.
-   Integrate LocalPlay's local video playback.
-   Accept a video dropped anywhere in the workspace.
-   Add simulated LIVE / PAUSED / COMPLETED session states.
-   Add Start Live Session behavior.
-   Add basic playback progress and elapsed-time display.
-   Prevent ordinary forward seeking.
-   Lock playback speed to 1×.
-   Add pause/resume.
-   Add session completion and reset behavior.
-   Connect the functionality to the Stitch-exported UI.

### Not included

-   Backend or database.
-   Cloud upload or storage.
-   User accounts or authentication.
-   Real live streaming.
-   Persistent video library.
-   DRM or tamper-proof anti-skip enforcement.
-   Notes, bookmarks, drawing tools, or other future toolbar tools.

------------------------------------------------------------------------

## Phase 0 --- Inspect and Prepare LocalPlay

-   [ ] Clone or download the LocalPlay repository.
-   [ ] Inspect its license and attribution requirements.
-   [ ] Run LocalPlay unchanged and verify it works.
-   [ ] Identify the drag-and-drop implementation.
-   [ ] Identify the file-picker implementation.
-   [ ] Identify the local video playback code.
-   [ ] Identify the video element and playback controls.
-   [ ] Identify how object URLs are created and cleaned up.
-   [ ] Record which files/components will be reused.
-   [ ] Avoid modifying unrelated LocalPlay functionality.

**Done when:** LocalPlay works locally, and the exact code to reuse is
identified.

------------------------------------------------------------------------

## Phase 1 --- Integrate the UI

-   [ ] Add the Stitch-exported HTML/CSS to the project.
-   [ ] Preserve the minimal Excalidraw-inspired dark workspace.
-   [ ] Keep the workspace as the primary drag-and-drop target.
-   [ ] Connect the Open Video toolbar action to the file picker.
-   [ ] Add a subtle empty-state drop hint.
-   [ ] Ensure the video area fits into the workspace.
-   [ ] Avoid duplicating the video player or file input unnecessarily.
-   [ ] Verify the UI remains usable at laptop and desktop sizes.

**Done when:** The exported UI is connected to the existing player and
file selection works.

------------------------------------------------------------------------

## Phase 2 --- Drag-and-Drop and Local Playback

-   [ ] Accept video files dropped anywhere in the workspace.
-   [ ] Support file selection through the Open Video button.
-   [ ] Reuse LocalPlay's local playback implementation.
-   [ ] Display the selected filename.
-   [ ] Show a ready state after selecting a video.
-   [ ] Do not start the session until Start Live Session is clicked.
-   [ ] Do not send the file to a server.
-   [ ] Handle invalid or unsupported files with a helpful message.
-   [ ] Clean up the previous video/object URL when replacing a file.
-   [ ] Ensure only one active video/player instance exists.

**Done when:** A local video can be selected, loaded, and played without
uploading it.

------------------------------------------------------------------------

## Phase 3 --- Session State Management

Create a simple session state controller.

### States

-   `idle` --- no video selected.
-   `ready` --- video selected, session not started.
-   `live` --- session is actively playing.
-   `paused` --- session is paused.
-   `completed` --- video reached its end.
-   `error` --- file or playback error.

### Tasks

-   [ ] Implement state transitions.
-   [ ] Start session from `ready`.
-   [ ] Start playback from timestamp `0`.
-   [ ] Update state when playback begins.
-   [ ] Update state when playback pauses.
-   [ ] Update state when playback resumes.
-   [ ] Update state when the video ends.
-   [ ] Reset state when another video is selected.
-   [ ] Prevent invalid state transitions where practical.

**Done when:** Session state always reflects the actual video playback
state.

------------------------------------------------------------------------

## Phase 4 --- Simulated LIVE Interface

-   [ ] Show a LIVE badge while playback is active.
-   [ ] Use a subtle red dot or indicator.
-   [ ] Add a small "Simulated Live" label or tooltip.
-   [ ] Show PAUSED when the user pauses.
-   [ ] Hide or change LIVE status when playback is stopped.
-   [ ] Show COMPLETED when the video ends.
-   [ ] Display the video filename.
-   [ ] Display elapsed playback time.
-   [ ] Display total duration when available.
-   [ ] Display a minimal progress indicator.
-   [ ] Ensure the progress indicator cannot be used to seek forward.
-   [ ] Keep the interface minimal and consistent with the Stitch
    design.

**Done when:** The UI visually reflects each session state correctly.

------------------------------------------------------------------------

## Phase 5 --- Playback Controls

-   [ ] Allow pause and resume.
-   [ ] Keep pause/resume progress intact.
-   [ ] Lock playback speed to `1×`.
-   [ ] Remove or hide the native seek bar.
-   [ ] Remove playback-speed controls.
-   [ ] Keep volume control if available.
-   [ ] Keep fullscreen control if available.
-   [ ] Prevent accidental playback restart when interacting with the
    UI.
-   [ ] Ensure replacing a video stops the previous session.

**Done when:** Playback controls are minimal and do not expose ordinary
forward skipping.

------------------------------------------------------------------------

## Phase 6 --- Anti-Skip Logic

### Goal

Prevent normal user interactions from jumping forward past content that
has not yet played.

### Tasks

-   [ ] Track the furthest playback timestamp reached.
-   [ ] Update the furthest-watched timestamp during normal playback.
-   [ ] Detect attempts to seek forward.
-   [ ] If the requested position is beyond the allowed position,
    restore the player to the allowed position.
-   [ ] Permit backward seeking only if desired; MVP default is to allow
    rewinding but not forward skipping.
-   [ ] Handle mouse-based seeking.
-   [ ] Handle keyboard-based seeking where feasible.
-   [ ] Ensure the progress display does not allow forward seeking.
-   [ ] Test repeated seek attempts.
-   [ ] Test seeking near the end of the video.
-   [ ] Ensure pause/resume does not reset the furthest-watched
    position.
-   [ ] Ensure selecting a new video resets the tracking state.

### Important limitation

This is client-side playback restriction. It can discourage ordinary
skipping but is not tamper-proof. A user with developer tools can bypass
browser-side controls. Do not describe the app as DRM-secure or
impossible to skip.

**Done when:** Forward seeking is blocked through normal UI interactions
and playback remains synchronized with the session state.

------------------------------------------------------------------------

## Phase 7 --- Completion and Reset

-   [ ] Detect the video's `ended` event.
-   [ ] Mark the session completed only when playback reaches the end.
-   [ ] Show a compact Session Completed message.
-   [ ] Provide an Open Another Video action.
-   [ ] Allow drag-and-drop of another video after completion.
-   [ ] Reset session state when a new video is selected.
-   [ ] Distinguish early stopping from completed playback.
-   [ ] Avoid marking a session completed when the user closes or
    abandons it.

**Done when:** Completion and restart work reliably.

------------------------------------------------------------------------

## Phase 8 --- Error Handling and Cleanup

-   [ ] Handle unsupported video formats.
-   [ ] Handle unreadable or damaged files.
-   [ ] Handle playback errors.
-   [ ] Display useful error messages.
-   [ ] Provide a way to select another file.
-   [ ] Clean up object URLs when replacing videos.
-   [ ] Avoid memory leaks from repeated video selection.
-   [ ] Avoid duplicate event listeners.
-   [ ] Avoid duplicate player instances.
-   [ ] Check browser console for errors.

**Done when:** Errors are recoverable and repeated use does not degrade
the app.

------------------------------------------------------------------------

## Phase 9 --- Testing

### Local file loading

-   [ ] Drag-and-drop a video.
-   [ ] Select a video through the file picker.
-   [ ] Replace one video with another.
-   [ ] Try an unsupported file.
-   [ ] Try a large video file.

### Playback

-   [ ] Start a session.
-   [ ] Pause and resume.
-   [ ] Confirm playback starts at zero.
-   [ ] Confirm playback speed stays at 1×.
-   [ ] Confirm elapsed time updates.
-   [ ] Confirm completion is detected.

### Anti-skip

-   [ ] Attempt to drag the timeline forward.
-   [ ] Attempt keyboard seeking.
-   [ ] Attempt to jump near the end.
-   [ ] Rewind and replay a previously watched section.
-   [ ] Pause and resume, then attempt forward seeking.
-   [ ] Confirm the UI progress indicator is not seekable.

### Privacy

-   [ ] Confirm no video upload endpoint exists.
-   [ ] Confirm the app does not send video content to external
    services.
-   [ ] Confirm original video files are not modified.
-   [ ] Confirm local playback works without a backend.

### UI

-   [ ] Test empty workspace.
-   [ ] Test ready state.
-   [ ] Test LIVE state.
-   [ ] Test PAUSED state.
-   [ ] Test COMPLETED state.
-   [ ] Test error state.
-   [ ] Test desktop and laptop viewport sizes.

------------------------------------------------------------------------

## Final Acceptance Checklist

-   [ ] LocalPlay drag-and-drop functionality is reused.
-   [ ] LocalPlay local video playback functionality is reused.
-   [ ] Videos stay on the user's computer.
-   [ ] User can drop a video anywhere on the workspace.
-   [ ] Open Video button works.
-   [ ] Start Live Session starts playback from the beginning.
-   [ ] LIVE indicator appears during playback.
-   [ ] PAUSED indicator appears during pause.
-   [ ] Session progress and elapsed time update correctly.
-   [ ] Forward seeking is blocked through normal controls.
-   [ ] Playback speed remains 1×.
-   [ ] Completion screen appears at the end.
-   [ ] User can load another video.
-   [ ] Error handling works.
-   [ ] No backend or video upload is required.
-   [ ] UI remains minimal and Excalidraw-inspired.

## Implementation Order

**Follow this order to avoid debugging too many things at once:**

1.  Inspect and run LocalPlay.
2.  Integrate the Stitch UI.
3.  Confirm drag-and-drop and local playback.
4.  Add session state.
5.  Add LIVE / PAUSED / COMPLETED UI.
6.  Add basic controls.
7.  Add anti-skip logic.
8.  Add completion and error handling.
9.  Test privacy, playback, and UI.
10. Polish.

**Core principle:** First make local playback work inside the new UI.
Then add the simulated live experience. Implement anti-skip last, after
the playback foundation is stable.
