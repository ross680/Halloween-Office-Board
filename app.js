(function () {
  var VERSION = "20261030a";
  var MEDIA = "assets/halloween.mp4?v=" + VERSION;
  var SOUND_KEY = "halloween-office-board-sound";
  var STALL_MS = 10000;
  var RELOAD_MS = 6 * 60 * 60 * 1000;
  var IDLE_MS = 4000;
  var SYNC_DRIFT = 0.4;

  var feature = document.getElementById("feature");
  var backdrop = document.getElementById("backdrop");
  var soundButton = document.getElementById("sound");

  var hasPlayed = false;
  var soundOn = false;
  var recovering = false;
  var ignoreErrorsUntil = 0;
  var lastTime = 0;
  var lastAdvanceAt = performance.now();
  var wakeLock = null;

  feature.loop = true;
  backdrop.loop = true;
  feature.playsInline = true;
  backdrop.playsInline = true;
  feature.preload = "auto";
  backdrop.preload = "auto";
  backdrop.muted = true;

  function soundRemembered() {
    try {
      return window.localStorage.getItem(SOUND_KEY) === "on";
    } catch (err) {
      return false;
    }
  }

  function rememberSound() {
    try {
      window.localStorage.setItem(SOUND_KEY, "on");
    } catch (err) {
      /* private mode and some TV browsers block storage */
    }
  }

  function forgetSound() {
    try {
      window.localStorage.removeItem(SOUND_KEY);
    } catch (err) {}
  }

  function playBackdrop() {
    backdrop.muted = true;
    var pending = backdrop.play();
    if (pending && pending.catch) pending.catch(function () {});
  }

  function hideSoundOverlay() {
    soundButton.hidden = true;
  }

  function showSoundOverlay() {
    soundButton.hidden = false;
    try {
      soundButton.focus();
    } catch (err) {}
  }

  function tryPlay(muted) {
    feature.muted = muted;
    if (!muted) feature.volume = 1;
    backdrop.muted = true;
    var pending = feature.play();
    playBackdrop();
    if (!pending || !pending.then) {
      return Promise.resolve(!feature.paused && (muted || !feature.muted));
    }
    return pending.then(function () {
      return !feature.paused && (muted || !feature.muted);
    }).catch(function () {
      return false;
    });
  }

  function boot() {
    // A stored tap means the next load must try sound again. A first
    // visit has no stored choice and still tries unmuted before muted.
    var preferUnmuted = soundRemembered();
    if (!preferUnmuted) preferUnmuted = true;
    tryPlay(!preferUnmuted).then(function (ok) {
      if (ok && !feature.muted) {
        soundOn = true;
        hideSoundOverlay();
        return;
      }
      tryPlay(true).then(function () {
        if (!soundOn) showSoundOverlay();
      });
    });
  }

  function enableSound() {
    if (soundOn) return;
    soundOn = true;
    feature.muted = false;
    feature.volume = 1;
    var pending = feature.play();
    playBackdrop();
    var finish = function () {
      rememberSound();
      hideSoundOverlay();
    };
    var rollback = function () {
      soundOn = false;
      feature.muted = true;
      forgetSound();
      showSoundOverlay();
    };
    if (pending && pending.then) {
      pending.then(finish).catch(rollback);
    } else if (feature.paused) {
      rollback();
    } else {
      finish();
    }
  }

  function isEnter(event) {
    return event.key === "Enter" || event.key === "NumpadEnter" || event.keyCode === 13;
  }

  function restartFromTop() {
    try {
      feature.currentTime = 0;
    } catch (err) {}
    var pending = feature.play();
    if (pending && pending.catch) pending.catch(function () {});
    try {
      backdrop.currentTime = 0;
    } catch (err) {}
    playBackdrop();
    lastTime = 0;
    lastAdvanceAt = performance.now();
  }

  function reloadVideo(video, src, time, muted) {
    function onReady() {
      video.removeEventListener("loadedmetadata", onReady);
      video.muted = muted;
      if (!muted) video.volume = 1;
      var duration = video.duration;
      if (time > 0.25 && isFinite(duration) && time < duration - 0.3) {
        try {
          video.currentTime = time;
        } catch (err) {}
      }
      var pending = video.play();
      if (pending && pending.catch) pending.catch(function () {});
    }
    video.addEventListener("loadedmetadata", onReady, { once: true });
    video.src = src;
    video.load();
  }

  function recover() {
    if (recovering) return;
    recovering = true;
    ignoreErrorsUntil = performance.now() + 5000;
    var resumeAt = feature.currentTime || 0;
    var keepMuted = feature.muted;
    var next = MEDIA + "&r=" + Date.now();
    reloadVideo(feature, next, resumeAt, keepMuted);
    reloadVideo(backdrop, next, resumeAt, true);
    window.setTimeout(function () {
      recovering = false;
      lastTime = feature.currentTime || 0;
      lastAdvanceAt = performance.now();
    }, 5000);
  }

  function noteProgress() {
    lastTime = feature.currentTime;
    lastAdvanceAt = performance.now();
  }

  feature.addEventListener("playing", function () {
    hasPlayed = true;
    noteProgress();
  });

  feature.addEventListener("timeupdate", function () {
    if (Math.abs(feature.currentTime - lastTime) > 0.05) noteProgress();
  });

  feature.addEventListener("ended", restartFromTop);
  backdrop.addEventListener("ended", function () {
    try {
      backdrop.currentTime = feature.currentTime || 0;
    } catch (err) {}
    playBackdrop();
  });

  feature.addEventListener("error", function () {
    if (performance.now() < ignoreErrorsUntil) return;
    recover();
  });

  feature.addEventListener("stalled", function () {
    var timeAtStall = feature.currentTime;
    window.setTimeout(function () {
      if (recovering || performance.now() < ignoreErrorsUntil) return;
      // Paused with data before the first gesture is the tap-for-sound
      // state, not a hung decoder.
      if (!hasPlayed && feature.paused && feature.readyState >= 2) return;
      var moved = Math.abs(feature.currentTime - timeAtStall) > 0.05;
      if (moved && feature.readyState >= 3) return;
      recover();
    }, 2000);
  });

  backdrop.addEventListener("error", function () {
    if (recovering || performance.now() < ignoreErrorsUntil) return;
    ignoreErrorsUntil = performance.now() + 4000;
    reloadVideo(backdrop, MEDIA + "&r=" + Date.now(), feature.currentTime || 0, true);
  });

  window.setInterval(function () {
    if (document.visibilityState === "visible" && hasPlayed && !recovering) {
      var now = performance.now();
      if (feature.ended) {
        restartFromTop();
      } else if (Math.abs(feature.currentTime - lastTime) > 0.05) {
        noteProgress();
      } else if (now - lastAdvanceAt >= STALL_MS) {
        recover();
      } else if (feature.paused) {
        var pending = feature.play();
        if (pending && pending.catch) pending.catch(function () {});
      }
    } else if (document.visibilityState !== "visible") {
      lastAdvanceAt = performance.now();
    }

    if (!recovering && backdrop.readyState >= 1) {
      var drift = Math.abs((backdrop.currentTime || 0) - (feature.currentTime || 0));
      if (drift > SYNC_DRIFT) {
        try {
          backdrop.currentTime = feature.currentTime;
        } catch (err) {}
      }
      if (backdrop.paused && !feature.paused) playBackdrop();
    }
  }, 1000);

  function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    if (document.visibilityState !== "visible") return;
    if (wakeLock) return;
    navigator.wakeLock.request("screen").then(function (sentinel) {
      wakeLock = sentinel;
      sentinel.addEventListener("release", function () {
        wakeLock = null;
        window.setTimeout(requestWakeLock, 1000);
      });
    }).catch(function () {
      wakeLock = null;
    });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    requestWakeLock();
    if (!hasPlayed) return;
    var pending = feature.play();
    if (pending && pending.catch) pending.catch(function () {});
    playBackdrop();
    lastAdvanceAt = performance.now();
  });

  var idleTimer = 0;
  function armCursorHide() {
    document.documentElement.classList.remove("cursor-hidden");
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(function () {
      document.documentElement.classList.add("cursor-hidden");
    }, IDLE_MS);
  }

  window.addEventListener("mousemove", armCursorHide, { passive: true });
  window.addEventListener("mousedown", armCursorHide, { passive: true });
  window.addEventListener("touchstart", armCursorHide, { passive: true });
  window.addEventListener("keydown", armCursorHide);

  soundButton.addEventListener("click", enableSound);
  window.addEventListener("keydown", function (event) {
    if (soundButton.hidden || !isEnter(event)) return;
    event.preventDefault();
    enableSound();
  });
  window.addEventListener("keypress", function (event) {
    if (soundButton.hidden || !isEnter(event)) return;
    event.preventDefault();
    enableSound();
  });

  window.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  var bootedAt = Date.now();
  window.setTimeout(function () {
    window.location.reload();
  }, RELOAD_MS);
  window.setInterval(function () {
    if (Date.now() - bootedAt >= RELOAD_MS) window.location.reload();
  }, 60 * 1000);

  armCursorHide();
  requestWakeLock();
  boot();
})();
