(function () {
  "use strict";

  var fs = require("fs");
  var os = require("os");
  var path = require("path");
  var childProcess = require("child_process");

  var currentPath = "";
  var history = [];
  var entries = [];
  var drives = [];
  var selected = null;
  var hoverDelayMs = 900;

  var protectedNames = {
    "$recycle.bin": true,
    "$sysreset": true,
    "$windows.~bt": true,
    "$windows.~ws": true,
    "appdata": true,
    "config.msi": true,
    "documents and settings": true,
    "msocache": true,
    "onedrivetemp": true,
    "pagefile.sys": true,
    "perflogs": true,
    "programdata": true,
    "recovery": true,
    "hiberfil.sys": true,
    "swapfile.sys": true,
    "system volume information": true,
    "windows": true
  };

  var imageExts = {
    ".bmp": true,
    ".gif": true,
    ".heic": true,
    ".jpg": true,
    ".jpeg": true,
    ".png": true,
    ".tga": true,
    ".tif": true,
    ".tiff": true,
    ".webp": true
  };

  var videoExts = {
    ".avi": true,
    ".m4v": true,
    ".mov": true,
    ".mp4": true,
    ".mxf": true,
    ".r3d": true,
    ".webm": true,
    ".wmv": true
  };

  var audioExts = {
    ".aif": true,
    ".aiff": true,
    ".m4a": true,
    ".mp3": true,
    ".wav": true
  };

  var pathInput = document.getElementById("pathInput");
  var filterInput = document.getElementById("filterInput");
  var fileGrid = document.getElementById("fileGrid");
  var status = document.getElementById("status");
  var driveList = document.getElementById("driveList");
  var drivePills = document.getElementById("drivePills");
  var breadcrumbs = document.getElementById("breadcrumbs");
  var importButton = document.getElementById("importButton");
  var revealButton = document.getElementById("revealButton");
  var showProtectedToggle = document.getElementById("showProtectedToggle");

  function setStatus(message, isError) {
    status.textContent = message;
    status.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function normalizeTarget(targetPath) {
    return path.resolve(targetPath.replace(/^~(?=$|[\\/])/, os.homedir()));
  }

  function isProtectedName(name) {
    if (showProtectedToggle.checked) return false;
    var lower = name.toLowerCase();
    return protectedNames[lower] || lower.charAt(0) === "." || lower.indexOf("$") === 0;
  }

  function isRoot(targetPath) {
    return path.parse(targetPath).root === targetPath;
  }

  function formatBytes(bytes) {
    if (!bytes) return "";
    var units = ["B", "KB", "MB", "GB", "TB"];
    var size = bytes;
    var unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return (unit === 0 ? size : size.toFixed(size < 10 ? 1 : 0)) + " " + units[unit];
  }

  function toFileUri(filePath) {
    var resolved = path.resolve(filePath).replace(/\\/g, "/");
    if (resolved.charAt(0) !== "/") resolved = "/" + resolved;
    return "file://" + encodeURI(resolved).replace(/#/g, "%23");
  }

  function extensionLabel(filePath) {
    var ext = path.extname(filePath).replace(".", "").toUpperCase();
    return ext || "FILE";
  }

  function isImportable(filePath) {
    var ext = path.extname(filePath).toLowerCase();
    return [
      ".aep", ".aepx", ".ai", ".aif", ".aiff", ".ari", ".arw", ".asf", ".avi",
      ".bmp", ".cin", ".cr2", ".crw", ".dng", ".dpx", ".eps", ".exr", ".gif",
      ".heic", ".iff", ".jpg", ".jpeg", ".m4a", ".m4v", ".mov", ".mp3", ".mp4",
      ".mxf", ".nef", ".obj", ".orf", ".pdf", ".png", ".psd", ".r3d", ".raf",
      ".sgi", ".tga", ".tif", ".tiff", ".wav", ".webm", ".wmv"
    ].indexOf(ext) !== -1;
  }

  function isVideoFile(filePath) {
    return !!videoExts[path.extname(filePath).toLowerCase()];
  }

  function safeStat(fullPath) {
    try {
      return fs.statSync(fullPath);
    } catch (error) {
      return null;
    }
  }

  function shellQuoteForExtendScript(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function evalAeScript(script, callback) {
    if (window.__adobe_cep__ && typeof window.__adobe_cep__.evalScript === "function") {
      window.__adobe_cep__.evalScript(script, callback || function () {});
      return;
    }
    setStatus("After Effects scripting bridge is not available.", true);
  }

  function getDrives() {
    var found = [];
    if (process.platform === "win32") {
      for (var code = 67; code <= 90; code += 1) {
        var drive = String.fromCharCode(code) + ":\\";
        try {
          if (fs.existsSync(drive)) found.push(drive);
        } catch (error) {}
      }
    } else {
      found.push("/");
      found.push(os.homedir());
    }
    return found;
  }

  function renderDriveList() {
    drives = getDrives();
    driveList.innerHTML = "";
    drivePills.innerHTML = "";
    drives.forEach(function (drive) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "drive-button" + (currentPath.indexOf(drive) === 0 ? " active" : "");
      button.title = drive;
      button.innerHTML = '<span class="drive-icon"></span><span>' + drive + '</span>';
      button.addEventListener("click", function () {
        openDirectory(drive, true);
      });
      driveList.appendChild(button);

      var pill = document.createElement("button");
      pill.type = "button";
      pill.className = "drive-pill" + (currentPath.indexOf(drive) === 0 ? " active" : "");
      pill.textContent = drive;
      pill.title = drive;
      pill.addEventListener("click", function () {
        openDirectory(drive, true);
      });
      drivePills.appendChild(pill);
    });
  }

  function renderThisPc() {
    currentPath = "";
    selected = null;
    entries = drives.map(function (drive) {
      return {
        name: drive,
        fullPath: drive,
        isDirectory: true,
        isDrive: true,
        size: 0
      };
    });
    pathInput.value = "This PC";
    importButton.disabled = true;
    revealButton.disabled = true;
    renderDriveList();
    renderBreadcrumbs();
    renderEntries();
    setStatus(drives.length + " drive" + (drives.length === 1 ? "" : "s"));
  }

  function openDirectory(targetPath, addHistory) {
    var resolved;
    try {
      resolved = normalizeTarget(targetPath);
      var stat = fs.statSync(resolved);
      if (!stat.isDirectory()) resolved = path.dirname(resolved);
    } catch (error) {
      fileGrid.innerHTML = '<div class="error">Cannot open this path.</div>';
      setStatus(error.message, true);
      return;
    }

    if (addHistory && currentPath && currentPath !== resolved) {
      history.push(currentPath);
    }

    currentPath = resolved;
    pathInput.value = currentPath;
    selected = null;
    importButton.disabled = true;
    revealButton.disabled = true;

    try {
      entries = fs.readdirSync(currentPath).reduce(function (list, name) {
        if (isProtectedName(name)) return list;

        var fullPath = path.join(currentPath, name);
        var stat = safeStat(fullPath);
        if (!stat) return list;

        list.push({
          name: name,
          fullPath: fullPath,
          isDirectory: stat.isDirectory(),
          size: stat.size,
          modified: stat.mtime
        });
        return list;
      }, []).sort(function (a, b) {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      renderDriveList();
      renderBreadcrumbs();
      renderEntries();
      setStatus(entries.length + " item" + (entries.length === 1 ? "" : "s"));
    } catch (error) {
      fileGrid.innerHTML = '<div class="error">This folder cannot be read.</div>';
      setStatus(error.message, true);
    }
  }

  function renderBreadcrumbs() {
    breadcrumbs.innerHTML = "";

    var pcButton = document.createElement("button");
    pcButton.type = "button";
    pcButton.className = "crumb";
    pcButton.textContent = "This PC";
    pcButton.addEventListener("click", renderThisPc);
    breadcrumbs.appendChild(pcButton);

    if (!currentPath) return;

    var parsed = path.parse(currentPath);
    var parts = currentPath.slice(parsed.root.length).split(/[\\/]/).filter(Boolean);
    var running = parsed.root;
    addSeparator();
    addCrumb(parsed.root, parsed.root);

    parts.forEach(function (part) {
      running = path.join(running, part);
      addSeparator();
      addCrumb(part, running);
    });
  }

  function addSeparator() {
    var separator = document.createElement("span");
    separator.className = "crumb-separator";
    separator.textContent = "/";
    breadcrumbs.appendChild(separator);
  }

  function addCrumb(label, target) {
    var crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = "crumb";
    crumb.textContent = label;
    crumb.title = target;
    crumb.addEventListener("click", function () {
      openDirectory(target, true);
    });
    breadcrumbs.appendChild(crumb);
  }

  function renderEntries() {
    var query = filterInput.value.trim().toLowerCase();
    var visible = entries.filter(function (entry) {
      return !query || entry.name.toLowerCase().indexOf(query) !== -1;
    });

    fileGrid.innerHTML = "";
    if (!visible.length) {
      fileGrid.innerHTML = '<div class="empty">No matching files or folders.</div>';
      return;
    }

    visible.forEach(function (entry) {
      fileGrid.appendChild(createTile(entry));
    });
  }

  function createTile(entry) {
    var tile = document.createElement("div");
    tile.className = "tile" + (selected && selected.fullPath === entry.fullPath ? " selected" : "");
    tile.title = entry.fullPath;
    tile.draggable = !entry.isDirectory && isImportable(entry.fullPath);

    var thumb = document.createElement("div");
    thumb.className = "thumb";
    renderThumb(entry, thumb);

    var name = document.createElement("div");
    name.className = "name";
    name.textContent = entry.name;

    var meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = entry.isDirectory ? (entry.isDrive ? "Drive" : "Folder") : formatBytes(entry.size);

    var actions = document.createElement("div");
    actions.className = "tile-actions";

    var revealTileButton = document.createElement("button");
    revealTileButton.type = "button";
    revealTileButton.className = "tile-button";
    revealTileButton.textContent = "Reveal";
    revealTileButton.addEventListener("click", function (event) {
      event.stopPropagation();
      selected = entry;
      revealSelected();
    });

    var importTileButton = document.createElement("button");
    importTileButton.type = "button";
    importTileButton.className = "tile-button primary";
    importTileButton.textContent = entry.isDirectory ? "Open" : "Import";
    importTileButton.disabled = !entry.isDirectory && !isImportable(entry.fullPath);
    importTileButton.addEventListener("click", function (event) {
      event.stopPropagation();
      selected = entry;
      if (entry.isDirectory) {
        openDirectory(entry.fullPath, true);
      } else {
        importSelected();
      }
    });

    actions.appendChild(revealTileButton);
    actions.appendChild(importTileButton);

    tile.appendChild(thumb);
    tile.appendChild(name);
    tile.appendChild(meta);
    tile.appendChild(actions);

    tile.addEventListener("click", function () {
      selected = entry;
      importButton.disabled = entry.isDirectory || !isImportable(entry.fullPath);
      revealButton.disabled = !entry.fullPath;
      renderEntries();
      setStatus(entry.fullPath);
    });

    tile.addEventListener("dblclick", function () {
      if (entry.isDirectory) {
        openDirectory(entry.fullPath, true);
      } else if (isImportable(entry.fullPath)) {
        importSelected();
      }
    });

    tile.addEventListener("dragstart", function (event) {
      if (entry.isDirectory || !isImportable(entry.fullPath)) {
        event.preventDefault();
        return;
      }
      selected = entry;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/plain", entry.fullPath);
      event.dataTransfer.setData("text/uri-list", toFileUri(entry.fullPath));
      event.dataTransfer.setData("DownloadURL", "application/octet-stream:" + entry.name + ":" + toFileUri(entry.fullPath));
      setStatus("Dragging: " + entry.name);
    });

    tile.addEventListener("dragend", function () {
      if (!entry.isDirectory && isImportable(entry.fullPath)) {
        selected = entry;
        importSelected(true);
        return;
      }
      setStatus(entry.fullPath);
    });

    if (!entry.isDirectory && isVideoFile(entry.fullPath)) {
      tile.addEventListener("mouseenter", function () {
        tile._previewTimer = window.setTimeout(function () {
          startHoverPreview(entry, thumb);
        }, hoverDelayMs);
      });

      tile.addEventListener("mouseleave", function () {
        window.clearTimeout(tile._previewTimer);
        stopHoverPreview(entry, thumb);
      });
    }

    return tile;
  }

  function renderThumb(entry, thumb) {
    if (entry.isDirectory) {
      var folder = document.createElement("div");
      folder.className = "folder-shape";
      thumb.appendChild(folder);
      return;
    }

    var ext = path.extname(entry.fullPath).toLowerCase();
    if (imageExts[ext]) {
      var image = document.createElement("img");
      image.alt = "";
      image.src = toFileUri(entry.fullPath);
      image.onerror = function () {
        thumb.innerHTML = "";
        thumb.appendChild(createBadge(entry, ext));
      };
      thumb.appendChild(image);
      return;
    }

    if (videoExts[ext]) {
      renderVideoThumbnail(entry, thumb, ext);
      return;
    }

    thumb.appendChild(createBadge(entry, ext));
  }

  function renderVideoThumbnail(entry, thumb, ext) {
    var video = createVideoElement(entry.fullPath);
    var times = [];
    var index = -1;
    var lastCanvas = null;
    var done = false;

    video.className = "probe-video";

    var fallbackTimer = window.setTimeout(function () {
      if (!done) finish(lastCanvas || createBadge(entry, ext));
    }, 4500);

    function finish(node) {
      if (done) return;
      done = true;
      window.clearTimeout(fallbackTimer);
      video.removeAttribute("src");
      video.load();
      thumb.innerHTML = "";
      thumb.appendChild(node);
    }

    function tryNextFrame() {
      if (done) return;
      index += 1;
      if (index >= times.length) {
        finish(lastCanvas || createBadge(entry, ext));
        return;
      }
      try {
        video.currentTime = times[index];
      } catch (error) {
        tryNextFrame();
      }
    }

    video.onerror = function () {
      finish(createBadge(entry, ext));
    };

    video.onloadedmetadata = function () {
      times = getVideoSampleTimes(video.duration);
      tryNextFrame();
    };

    video.onseeked = function () {
      var canvas = captureVideoFrame(video);
      if (!canvas) {
        tryNextFrame();
        return;
      }
      lastCanvas = canvas;
      if (!isMostlyBlack(canvas)) {
        finish(canvas);
        return;
      }
      tryNextFrame();
    };

    thumb.innerHTML = "";
    thumb.appendChild(createBadge(entry, ext));
    thumb.appendChild(video);
  }

  function createVideoElement(filePath) {
    var video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = toFileUri(filePath);
    return video;
  }

  function getVideoSampleTimes(duration) {
    var fallback = [0.2, 0.75, 1.5, 3];
    if (!duration || !isFinite(duration) || duration <= 0.2) return fallback;
    return [
      Math.min(duration - 0.05, Math.max(0.1, duration * 0.08)),
      Math.min(duration - 0.05, Math.max(0.2, duration * 0.22)),
      Math.min(duration - 0.05, Math.max(0.3, duration * 0.42)),
      Math.min(duration - 0.05, Math.max(0.4, duration * 0.68)),
      Math.min(duration - 0.05, Math.max(0.5, duration * 0.86))
    ];
  }

  function captureVideoFrame(video) {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(160, video.videoWidth || 160);
      canvas.height = Math.max(90, video.videoHeight || 90);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas;
    } catch (error) {
      return null;
    }
  }

  function isMostlyBlack(canvas) {
    try {
      var sample = document.createElement("canvas");
      sample.width = 32;
      sample.height = 18;
      var context = sample.getContext("2d");
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      var pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      var total = 0;
      for (var i = 0; i < pixels.length; i += 4) {
        total += pixels[i] + pixels[i + 1] + pixels[i + 2];
      }
      return total / (pixels.length / 4) < 34;
    } catch (error) {
      return false;
    }
  }

  function startHoverPreview(entry, thumb) {
    var ext = path.extname(entry.fullPath).toLowerCase();
    if (!videoExts[ext]) return;

    var video = createVideoElement(entry.fullPath);
    video.className = "hover-video";
    video.loop = true;
    video.autoplay = true;
    video.controls = false;
    video.onloadedmetadata = function () {
      try {
        video.currentTime = Math.min(1, Math.max(0, (video.duration || 1) * 0.08));
      } catch (error) {}
      var promise = video.play();
      if (promise && promise.catch) promise.catch(function () {});
    };
    video.onerror = function () {
      stopHoverPreview(entry, thumb);
    };

    thumb.innerHTML = "";
    thumb.appendChild(video);
    setStatus("Previewing: " + entry.name);
  }

  function stopHoverPreview(entry, thumb) {
    var playing = thumb.querySelector(".hover-video");
    if (playing) {
      try {
        playing.pause();
        playing.removeAttribute("src");
        playing.load();
      } catch (error) {}
      thumb.innerHTML = "";
      renderThumb(entry, thumb);
    }
  }

  function createBadge(entry, ext) {
    var badge = document.createElement("div");
    var type = "";
    if (videoExts[ext]) type = " video";
    if (audioExts[ext]) type = " audio";
    if (ext === ".aep" || ext === ".aepx") type = " project";
    badge.className = "file-badge" + type;
    badge.textContent = extensionLabel(entry.fullPath);
    return badge;
  }

  function importSelected(addToTimeline) {
    if (!selected || selected.isDirectory) return;
    var functionName = addToTimeline ? "AEFileExplorer_importFileToActiveComp" : "AEFileExplorer_importFile";
    var script = functionName + '("' + shellQuoteForExtendScript(selected.fullPath) + '")';
    setStatus((addToTimeline ? "Adding to timeline " : "Importing ") + selected.name + "...");
    evalAeScript(script, function (result) {
      setStatus(result || "Import finished");
    });
  }

  function revealSelected() {
    if (!selected || !selected.fullPath) return;
    try {
      if (process.platform === "win32") {
        var args = selected.isDirectory ? [selected.fullPath] : ["/select,", selected.fullPath];
        childProcess.execFile("explorer.exe", args);
      } else if (process.platform === "darwin") {
        childProcess.execFile("open", selected.isDirectory ? [selected.fullPath] : ["-R", selected.fullPath]);
      } else {
        childProcess.execFile("xdg-open", [selected.isDirectory ? selected.fullPath : path.dirname(selected.fullPath)]);
      }
      setStatus("Revealed in system file explorer");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  document.getElementById("thisPcButton").addEventListener("click", renderThisPc);

  document.getElementById("homeButton").addEventListener("click", function () {
    openDirectory(os.homedir(), true);
  });

  document.getElementById("backButton").addEventListener("click", function () {
    var previous = history.pop();
    if (previous) openDirectory(previous, false);
  });

  document.getElementById("upButton").addEventListener("click", function () {
    if (!currentPath) return;
    if (isRoot(currentPath)) {
      renderThisPc();
      return;
    }
    openDirectory(path.dirname(currentPath), true);
  });

  document.getElementById("refreshButton").addEventListener("click", function () {
    if (currentPath) {
      openDirectory(currentPath, false);
    } else {
      renderThisPc();
    }
  });

  pathInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") openDirectory(pathInput.value, true);
  });

  filterInput.addEventListener("input", renderEntries);
  showProtectedToggle.addEventListener("change", function () {
    if (currentPath) {
      openDirectory(currentPath, false);
    } else {
      renderThisPc();
    }
  });
  importButton.addEventListener("click", function () {
    importSelected(false);
  });
  revealButton.addEventListener("click", revealSelected);

  drives = getDrives();
  renderThisPc();
}());
