// ===================================
// Livex - Live Session Simulator
// Based on LocalPlay by Syed Mughees Ali (MIT)
// ===================================

// DOM Elements - States
const stateIdle = document.getElementById('state-idle');
const stateReady = document.getElementById('state-ready');
const stateActive = document.getElementById('state-active');
const stateCompleted = document.getElementById('state-completed');
const stateError = document.getElementById('state-error');

// DOM Elements - Controls
const videoInput = document.getElementById('video-input');
const openVideoBtn = document.getElementById('open-video-btn');
const video = document.getElementById('video');
const filenameReady = document.getElementById('filename-ready');
const filenameActive = document.getElementById('filename-active');
const changeVideoBtn = document.getElementById('change-video-btn');
const startSessionBtn = document.getElementById('start-session-btn');
const openAnotherBtn = document.getElementById('open-another-btn');
const tryAnotherBtn = document.getElementById('try-another-btn');

// DOM Elements - Playback
const liveBadge = document.getElementById('live-badge');
const pausedBadge = document.getElementById('paused-badge');
const progressFill = document.getElementById('progress-fill');
const timeDisplay = document.getElementById('time-display');
const pauseBtn = document.getElementById('pause-btn');
const resumeBtn = document.getElementById('resume-btn');
const volumeBtn = document.getElementById('volume-btn');
const volumeIcon = document.getElementById('volume-icon');
const volumeSlider = document.getElementById('volume-slider');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const errorMessageText = document.getElementById('error-message-text');

// State Management
let videoUrl = '';
let currentFile = null;
let sessionState = 'idle'; // idle, ready, live, paused, completed, error
let furthestWatchedTime = 0;
let isSeekingBlocked = false;

// ===================================
// Utility Functions
// ===================================

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) {
        return '00:00';
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const paddedMinutes = String(minutes).padStart(2, '0');
    const paddedSeconds = String(remainingSeconds).padStart(2, '0');

    if (hours > 0) {
        return `${hours}:${paddedMinutes}:${paddedSeconds}`;
    }
    return `${paddedMinutes}:${paddedSeconds}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// ===================================
// State Management
// ===================================

function setState(newState) {
    console.log(`State transition: ${sessionState} -> ${newState}`);
    sessionState = newState;

    // Hide all states
    stateIdle.classList.add('hidden');
    stateReady.classList.add('hidden');
    stateActive.classList.add('hidden');
    stateCompleted.classList.add('hidden');
    stateError.classList.add('hidden');

    // Show appropriate state
    switch (newState) {
        case 'idle':
            stateIdle.classList.remove('hidden');
            break;
        case 'ready':
            stateReady.classList.remove('hidden');
            stateReady.classList.add('flex');
            break;
        case 'live':
            stateActive.classList.remove('hidden');
            stateActive.classList.add('flex');
            liveBadge.classList.remove('hidden');
            pausedBadge.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
            resumeBtn.classList.add('hidden');
            break;
        case 'paused':
            stateActive.classList.remove('hidden');
            stateActive.classList.add('flex');
            liveBadge.classList.add('hidden');
            pausedBadge.classList.remove('hidden');
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.remove('hidden');
            break;
        case 'completed':
            stateCompleted.classList.remove('hidden');
            stateCompleted.classList.add('flex');
            break;
        case 'error':
            stateError.classList.remove('hidden');
            stateError.classList.add('flex');
            break;
    }
}

// ===================================
// Video Loading
// ===================================

function loadVideo(file) {
    if (!file) return;

    const videoExtensions = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv'];
    const extension = file.name.split('.').pop().toLowerCase();
    const isVideo = file.type.startsWith('video/') || videoExtensions.includes(extension);

    if (!isVideo) {
        errorMessageText.textContent = 'Please choose a valid video file.';
        setState('error');
        return;
    }

    // Clean up previous video
    if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
    }

    // Reset state
    furthestWatchedTime = 0;
    video.currentTime = 0;

    // Create object URL
    videoUrl = URL.createObjectURL(file);
    video.src = videoUrl;
    video.load();

    currentFile = file;

    // Update UI with filename
    filenameReady.textContent = file.name;
    filenameActive.textContent = file.name;

    setState('ready');
}

// ===================================
// Drag and Drop
// ===================================

['dragenter', 'dragover'].forEach(eventName => {
    window.addEventListener(eventName, (e) => {
        e.preventDefault();
        if (sessionState === 'idle') {
            stateIdle.style.transform = 'scale(1.02)';
        }
    });
});

['dragleave', 'drop'].forEach(eventName => {
    window.addEventListener(eventName, (e) => {
        e.preventDefault();
        if (sessionState === 'idle') {
            stateIdle.style.transform = 'scale(1)';
        }
    });
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
        loadVideo(file);
    }
});

// ===================================
// File Picker
// ===================================

openVideoBtn.addEventListener('click', () => {
    videoInput.click();
});

if (changeVideoBtn) {
    changeVideoBtn.addEventListener('click', () => {
        videoInput.click();
    });
}

if (openAnotherBtn) {
    openAnotherBtn.addEventListener('click', () => {
        videoInput.click();
    });
}

if (tryAnotherBtn) {
    tryAnotherBtn.addEventListener('click', () => {
        videoInput.click();
    });
}

videoInput.addEventListener('change', () => {
    loadVideo(videoInput.files[0]);
    videoInput.value = '';
});

// ===================================
// Session Control
// ===================================

async function startSession() {
    if (sessionState !== 'ready') return;

    // Move video element to active state container
    const activeVideoContainer = stateActive.querySelector('.aspect-video');
    activeVideoContainer.appendChild(video);

    // Reset to beginning
    video.currentTime = 0;
    furthestWatchedTime = 0;

    // Lock playback speed to 1x
    video.playbackRate = 1.0;

    try {
        await video.play();
        setState('live');
    } catch (error) {
        console.error('Playback error:', error);
        errorMessageText.textContent = 'Could not start playback. Please try another video.';
        setState('error');
    }
}

if (startSessionBtn) {
    startSessionBtn.addEventListener('click', startSession);
}

function pauseSession() {
    if (sessionState !== 'live') return;
    video.pause();
    setState('paused');
}

function resumeSession() {
    if (sessionState !== 'paused') return;
    video.play();
    setState('live');
}

if (pauseBtn) {
    pauseBtn.addEventListener('click', pauseSession);
}

if (resumeBtn) {
    resumeBtn.addEventListener('click', resumeSession);
}

// ===================================
// Anti-Skip Logic
// ===================================

function updateFurthestWatched() {
    if (sessionState === 'live' && video.currentTime > furthestWatchedTime) {
        furthestWatchedTime = video.currentTime;
    }
}

function enforceAntiSkip() {
    // If user tries to seek beyond furthest watched point, block it
    if (video.currentTime > furthestWatchedTime + 0.5) {
        console.log('Forward seek blocked:', video.currentTime, 'max allowed:', furthestWatchedTime);
        isSeekingBlocked = true;
        video.currentTime = furthestWatchedTime;
    }
}

video.addEventListener('timeupdate', () => {
    updateFurthestWatched();
    updateProgress();
});

video.addEventListener('seeking', () => {
    if (!isSeekingBlocked && (sessionState === 'live' || sessionState === 'paused')) {
        enforceAntiSkip();
    }
});

video.addEventListener('seeked', () => {
    isSeekingBlocked = false;
});

// ===================================
// Progress Display
// ===================================

function updateProgress() {
    if (!Number.isFinite(video.duration)) {
        if (progressFill) progressFill.style.width = '0%';
        if (timeDisplay) timeDisplay.textContent = '00:00 / 00:00';
        return;
    }

    const progress = (video.currentTime / video.duration) * 100;
    if (progressFill) progressFill.style.width = `${progress}%`;
    if (timeDisplay) timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}

video.addEventListener('loadedmetadata', updateProgress);

// ===================================
// Playback Speed Lock
// ===================================

video.addEventListener('ratechange', () => {
    if (video.playbackRate !== 1.0 && (sessionState === 'live' || sessionState === 'paused')) {
        video.playbackRate = 1.0;
    }
});

// ===================================
// Completion Handling
// ===================================

video.addEventListener('ended', () => {
    if (sessionState === 'live') {
        setState('completed');
    }
});

// ===================================
// Volume Controls
// ===================================

if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
        video.volume = volumeSlider.value;
        video.muted = Number(volumeSlider.value) === 0;
        updateVolumeButton();
    });
}

if (volumeBtn) {
    volumeBtn.addEventListener('click', () => {
        video.muted = !video.muted;
        if (video.muted) {
            volumeSlider.value = 0;
        } else {
            volumeSlider.value = video.volume || 0.5;
        }
        updateVolumeButton();
    });
}

function updateVolumeButton() {
    if (!volumeIcon) return;

    if (video.muted || video.volume === 0) {
        volumeIcon.textContent = '🔇';
        volumeBtn.title = 'Unmute';
    } else if (video.volume < 0.5) {
        volumeIcon.textContent = '🔉';
        volumeBtn.title = 'Mute';
    } else {
        volumeIcon.textContent = '🔊';
        volumeBtn.title = 'Mute';
    }
}

video.addEventListener('volumechange', updateVolumeButton);

// ===================================
// Fullscreen Controls
// ===================================

async function toggleFullscreen() {
    if (!currentFile) return;

    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;

    // Exit fullscreen
    if (fullscreenElement) {
        const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
        try {
            await exitFullscreen.call(document);
        } catch (error) {
            console.error('Could not exit fullscreen:', error);
        }
        return;
    }

    if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
        video.webkitExitFullscreen();
        return;
    }

    // Enter fullscreen
    const container = stateActive;
    const requestFullscreen = container.requestFullscreen || container.webkitRequestFullscreen;

    if (requestFullscreen) {
        try {
            await requestFullscreen.call(container);
            return;
        } catch (error) {
            // Try video element fallback
        }
    }

    // iPhone Safari fallback
    if (video.webkitEnterFullscreen) {
        try {
            video.webkitEnterFullscreen();
            return;
        } catch (error) {
            console.error('Fullscreen not available');
        }
    }
}

function updateFullscreenButton() {
    if (!fullscreenIcon) return;

    const standardFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    const isFullscreen = Boolean(standardFullscreen || video.webkitDisplayingFullscreen);
    fullscreenIcon.textContent = isFullscreen ? '✕' : '⛶';
    fullscreenBtn.title = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
}

if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
}

document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
video.addEventListener('webkitbeginfullscreen', updateFullscreenButton);
video.addEventListener('webkitendfullscreen', updateFullscreenButton);

// ===================================
// Keyboard Shortcuts
// ===================================

document.addEventListener('keydown', (e) => {
    const tagName = document.activeElement.tagName;
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'BUTTON') {
        return;
    }

    // ⌘O / Ctrl+O - Open video
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        videoInput.click();
    }
    // Space - Play/Pause/Start
    else if (e.code === 'Space') {
        e.preventDefault();
        if (sessionState === 'live') {
            pauseSession();
        } else if (sessionState === 'paused') {
            resumeSession();
        } else if (sessionState === 'ready') {
            startSession();
        }
    }
    // M - Mute/Unmute
    else if (e.key.toLowerCase() === 'm' && volumeBtn) {
        volumeBtn.click();
    }
    // F - Fullscreen
    else if (e.key.toLowerCase() === 'f') {
        toggleFullscreen();
    }
    // Enter - Start session (when ready)
    else if (e.key === 'Enter' && sessionState === 'ready') {
        startSession();
    }
});

// ===================================
// Error Handling
// ===================================

video.addEventListener('error', () => {
    if (video.error) {
        let message = 'An error occurred while playing the video.';

        switch (video.error.code) {
            case video.error.MEDIA_ERR_ABORTED:
                message = 'Video playback was aborted.';
                break;
            case video.error.MEDIA_ERR_NETWORK:
                message = 'A network error caused the video to fail.';
                break;
            case video.error.MEDIA_ERR_DECODE:
                message = 'The video could not be decoded. Format may be unsupported.';
                break;
            case video.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                message = 'This video format is not supported by your browser.';
                break;
        }

        errorMessageText.textContent = message;
        setState('error');
    }
});

// ===================================
// Cleanup
// ===================================

window.addEventListener('beforeunload', () => {
    if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
    }
});

// ===================================
// Initialize
// ===================================

console.log('Livex initialized - Live session simulator ready');
setState('idle');
