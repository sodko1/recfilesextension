/* global app, File, ImportOptions */
function AEFileExplorer_importFile(filePath) {
  try {
    var file = new File(filePath);
    if (!file.exists) {
      return "File does not exist.";
    }

    app.beginUndoGroup("Import File From AE File Explorer");
    var importOptions = new ImportOptions(file);

    if (!importOptions.canImportAs) {
      app.project.importFile(importOptions);
    } else {
      app.project.importFile(importOptions);
    }

    app.endUndoGroup();
    return "Imported: " + file.displayName;
  } catch (error) {
    try {
      app.endUndoGroup();
    } catch (ignored) {}
    return "Import failed: " + error.toString();
  }
}

function AEFileExplorer_importFileToActiveComp(filePath) {
  try {
    var file = new File(filePath);
    if (!file.exists) {
      return "File does not exist.";
    }

    app.beginUndoGroup("RecFiles Import To Timeline");
    var importOptions = new ImportOptions(file);
    var importedItem = app.project.importFile(importOptions);
    var activeItem = app.project.activeItem;

    if (!activeItem || !(activeItem instanceof CompItem)) {
      app.endUndoGroup();
      return "Imported to project. Select or open a comp to add it to the timeline.";
    }

    var layer = activeItem.layers.add(importedItem);
    layer.startTime = activeItem.time;
    app.endUndoGroup();
    return "Added to timeline: " + file.displayName;
  } catch (error) {
    try {
      app.endUndoGroup();
    } catch (ignored) {}
    return "Timeline import failed: " + error.toString();
  }
}
