
  var Module = typeof Module !== 'undefined' ? Module : {};

  if (!Module.expectedDataFileDownloads) {
    Module.expectedDataFileDownloads = 0;
  }

  Module.expectedDataFileDownloads++;
  (function() {
    // When running as a pthread, FS operations are proxied to the main thread, so we don't need to
    // fetch the .data bundle on the worker
    if (Module['ENVIRONMENT_IS_PTHREAD']) return;
    var loadPackage = function(metadata) {

      var PACKAGE_PATH = '';
      if (typeof window === 'object') {
        PACKAGE_PATH = window['encodeURIComponent'](window.location.pathname.toString().substring(0, window.location.pathname.toString().lastIndexOf('/')) + '/');
      } else if (typeof process === 'undefined' && typeof location !== 'undefined') {
        // web worker
        PACKAGE_PATH = encodeURIComponent(location.pathname.toString().substring(0, location.pathname.toString().lastIndexOf('/')) + '/');
      }
      var PACKAGE_NAME = 'fr.data';
      var REMOTE_PACKAGE_BASE = 'fr.data';
      if (typeof Module['locateFilePackage'] === 'function' && !Module['locateFile']) {
        Module['locateFile'] = Module['locateFilePackage'];
        err('warning: you defined Module.locateFilePackage, that has been renamed to Module.locateFile (using your locateFilePackage for now)');
      }
      var REMOTE_PACKAGE_NAME = Module['locateFile'] ? Module['locateFile'](REMOTE_PACKAGE_BASE, '') : REMOTE_PACKAGE_BASE;
var REMOTE_PACKAGE_SIZE = metadata['remote_package_size'];

      function fetchRemotePackage(packageName, packageSize, callback, errback) {
        if (typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string') {
          require('fs').readFile(packageName, function(err, contents) {
            if (err) {
              errback(err);
            } else {
              callback(contents.buffer);
            }
          });
          return;
        }
        var xhr = new XMLHttpRequest();
        xhr.open('GET', packageName, true);
        xhr.responseType = 'arraybuffer';
        xhr.onprogress = function(event) {
          var url = packageName;
          var size = packageSize;
          if (event.total) size = event.total;
          if (event.loaded) {
            if (!xhr.addedTotal) {
              xhr.addedTotal = true;
              if (!Module.dataFileDownloads) Module.dataFileDownloads = {};
              Module.dataFileDownloads[url] = {
                loaded: event.loaded,
                total: size
              };
            } else {
              Module.dataFileDownloads[url].loaded = event.loaded;
            }
            var total = 0;
            var loaded = 0;
            var num = 0;
            for (var download in Module.dataFileDownloads) {
            var data = Module.dataFileDownloads[download];
              total += data.total;
              loaded += data.loaded;
              num++;
            }
            total = Math.ceil(total * Module.expectedDataFileDownloads/num);
            if (Module['setStatus']) Module['setStatus']('Downloading data... (' + loaded + '/' + total + ')');
          } else if (!Module.dataFileDownloads) {
            if (Module['setStatus']) Module['setStatus']('Downloading data...');
          }
        };
        xhr.onerror = function(event) {
          throw new Error("NetworkError for: " + packageName);
        }
        xhr.onload = function(event) {
          if (xhr.status == 200 || xhr.status == 304 || xhr.status == 206 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
            var packageData = xhr.response;
            callback(packageData);
          } else {
            throw new Error(xhr.statusText + " : " + xhr.responseURL);
          }
        };
        xhr.send(null);
      };

      function handleError(error) {
        console.error('package error:', error);
      };

      var fetchedCallback = null;
      var fetched = Module['getPreloadedPackage'] ? Module['getPreloadedPackage'](REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE) : null;

      if (!fetched) fetchRemotePackage(REMOTE_PACKAGE_NAME, REMOTE_PACKAGE_SIZE, function(data) {
        if (fetchedCallback) {
          fetchedCallback(data);
          fetchedCallback = null;
        } else {
          fetched = data;
        }
      }, handleError);

    function runWithFS() {

      function assert(check, msg) {
        if (!check) throw msg + new Error().stack;
      }
Module['FS_createPath']("/", "resources_js", true, true);
Module['FS_createPath']("/resources_js", "fr", true, true);
Module['FS_createPath']("/resources_js/fr", "hunspell", true, true);
Module['FS_createPath']("/resources_js/fr", "ngrams_db", true, true);
Module['FS_createPath']("/resources_js/fr", "aspell", true, true);

      /** @constructor */
      function DataRequest(start, end, audio) {
        this.start = start;
        this.end = end;
        this.audio = audio;
      }
      DataRequest.prototype = {
        requests: {},
        open: function(mode, name) {
          this.name = name;
          this.requests[name] = this;
          Module['addRunDependency']('fp ' + this.name);
        },
        send: function() {},
        onload: function() {
          var byteArray = this.byteArray.subarray(this.start, this.end);
          this.finish(byteArray);
        },
        finish: function(byteArray) {
          var that = this;
          // canOwn this data in the filesystem, it is a slide into the heap that will never change
          Module['FS_createDataFile'](this.name, null, byteArray, true, true, true);
          Module['removeRunDependency']('fp ' + that.name);
          this.requests[this.name] = null;
        }
      };

      var files = metadata['files'];
      for (var i = 0; i < files.length; ++i) {
        new DataRequest(files[i]['start'], files[i]['end'], files[i]['audio'] || 0).open('GET', files[i]['filename']);
      }

      function processPackageData(arrayBuffer) {
        assert(arrayBuffer, 'Loading data file failed.');
        assert(arrayBuffer instanceof ArrayBuffer, 'bad input to processPackageData');
        var byteArray = new Uint8Array(arrayBuffer);
        var curr;
        // Reuse the bytearray from the XHR as the source for file reads.
          DataRequest.prototype.byteArray = byteArray;
          var files = metadata['files'];
          for (var i = 0; i < files.length; ++i) {
            DataRequest.prototype.requests[files[i].filename].onload();
          }          Module['removeRunDependency']('datafile_fr.data');

      };
      Module['addRunDependency']('datafile_fr.data');

      if (!Module.preloadResults) Module.preloadResults = {};

      Module.preloadResults[PACKAGE_NAME] = {fromCache: false};
      if (fetched) {
        processPackageData(fetched);
        fetched = null;
      } else {
        fetchedCallback = processPackageData;
      }

    }
    if (Module['calledRun']) {
      runWithFS();
    } else {
      if (!Module['preRun']) Module['preRun'] = [];
      Module["preRun"].push(runWithFS); // FS is not initialized yet, wait for it
    }

    }
    loadPackage({"files": [{"filename": "/resources_js/fr/presage.xml", "start": 0, "end": 2809}, {"filename": "/resources_js/fr/hunspell/fr_FR.aff", "start": 2809, "end": 295078}, {"filename": "/resources_js/fr/hunspell/fr_FR.dic", "start": 295078, "end": 2887129}, {"filename": "/resources_js/fr/ngrams_db/ngrams.counts", "start": 2887129, "end": 11149053}, {"filename": "/resources_js/fr/ngrams_db/ngrams.trie", "start": 11149053, "end": 22438461}, {"filename": "/resources_js/fr/aspell/fr_FR-lrg.alias", "start": 22438461, "end": 22438539}, {"filename": "/resources_js/fr/aspell/fr-med.alias", "start": 22438539, "end": 22438617}, {"filename": "/resources_js/fr/aspell/fr.dat", "start": 22438617, "end": 22438743}, {"filename": "/resources_js/fr/aspell/fr_FR-med.alias", "start": 22438743, "end": 22438821}, {"filename": "/resources_js/fr/aspell/fr_CH-only.rws", "start": 22438821, "end": 22441637}, {"filename": "/resources_js/fr/aspell/suisse-lrg.alias", "start": 22441637, "end": 22441715}, {"filename": "/resources_js/fr/aspell/fr_FR-80.multi", "start": 22441715, "end": 22441831}, {"filename": "/resources_js/fr/aspell/fr-60.multi", "start": 22441831, "end": 22441909}, {"filename": "/resources_js/fr/aspell/french-sml.alias", "start": 22441909, "end": 22441987}, {"filename": "/resources_js/fr/aspell/fr_CH-80.multi", "start": 22441987, "end": 22442122}, {"filename": "/resources_js/fr/aspell/standard.kbd", "start": 22442122, "end": 22442222}, {"filename": "/resources_js/fr/aspell/francais-40.alias", "start": 22442222, "end": 22442300}, {"filename": "/resources_js/fr/aspell/french-40.alias", "start": 22442300, "end": 22442378}, {"filename": "/resources_js/fr/aspell/fr-40.multi", "start": 22442378, "end": 22442456}, {"filename": "/resources_js/fr/aspell/suisse-80.alias", "start": 22442456, "end": 22442534}, {"filename": "/resources_js/fr/aspell/fr_FR-60.multi", "start": 22442534, "end": 22442631}, {"filename": "/resources_js/fr/aspell/french-med.alias", "start": 22442631, "end": 22442709}, {"filename": "/resources_js/fr/aspell/nroff.amf", "start": 22442709, "end": 22442858}, {"filename": "/resources_js/fr/aspell/suisse-med.alias", "start": 22442858, "end": 22442936}, {"filename": "/resources_js/fr/aspell/francais-med.alias", "start": 22442936, "end": 22443014}, {"filename": "/resources_js/fr/aspell/fr_CH-60.multi", "start": 22443014, "end": 22443130}, {"filename": "/resources_js/fr/aspell/fr_CH.multi", "start": 22443130, "end": 22443208}, {"filename": "/resources_js/fr/aspell/suisse-60.alias", "start": 22443208, "end": 22443286}, {"filename": "/resources_js/fr/aspell/french-60.alias", "start": 22443286, "end": 22443364}, {"filename": "/resources_js/fr/aspell/francais.alias", "start": 22443364, "end": 22443439}, {"filename": "/resources_js/fr/aspell/suisse.alias", "start": 22443439, "end": 22443514}, {"filename": "/resources_js/fr/aspell/fr-sml.alias", "start": 22443514, "end": 22443592}, {"filename": "/resources_js/fr/aspell/suisse-40.alias", "start": 22443592, "end": 22443670}, {"filename": "/resources_js/fr/aspell/fr_FR-sml.alias", "start": 22443670, "end": 22443748}, {"filename": "/resources_js/fr/aspell/fr_CH-40.multi", "start": 22443748, "end": 22443845}, {"filename": "/resources_js/fr/aspell/francais-60.alias", "start": 22443845, "end": 22443923}, {"filename": "/resources_js/fr/aspell/francais-80.alias", "start": 22443923, "end": 22444001}, {"filename": "/resources_js/fr/aspell/suisse-sml.alias", "start": 22444001, "end": 22444079}, {"filename": "/resources_js/fr/aspell/fr-80-only.rws", "start": 22444079, "end": 22778959}, {"filename": "/resources_js/fr/aspell/fr-lrg.alias", "start": 22778959, "end": 22779037}, {"filename": "/resources_js/fr/aspell/fr_phonet.dat", "start": 22779037, "end": 22781968}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cset", "start": 22781968, "end": 22795816}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cmap", "start": 22795816, "end": 22826710}, {"filename": "/resources_js/fr/aspell/fr.multi", "start": 22826710, "end": 22826785}, {"filename": "/resources_js/fr/aspell/french.alias", "start": 22826785, "end": 22826860}, {"filename": "/resources_js/fr/aspell/fr_FR.multi", "start": 22826860, "end": 22826938}, {"filename": "/resources_js/fr/aspell/francais-sml.alias", "start": 22826938, "end": 22827016}, {"filename": "/resources_js/fr/aspell/fr_CH-sml.alias", "start": 22827016, "end": 22827094}, {"filename": "/resources_js/fr/aspell/francais-lrg.alias", "start": 22827094, "end": 22827172}, {"filename": "/resources_js/fr/aspell/french-lrg.alias", "start": 22827172, "end": 22827250}, {"filename": "/resources_js/fr/aspell/fr-40-only.rws", "start": 22827250, "end": 28653986}, {"filename": "/resources_js/fr/aspell/french-80.alias", "start": 28653986, "end": 28654064}, {"filename": "/resources_js/fr/aspell/fr_CH-lrg.alias", "start": 28654064, "end": 28654142}, {"filename": "/resources_js/fr/aspell/fr_CH-med.alias", "start": 28654142, "end": 28654220}, {"filename": "/resources_js/fr/aspell/fr-60-only.rws", "start": 28654220, "end": 40244956}, {"filename": "/resources_js/fr/aspell/fr_FR-40.multi", "start": 40244956, "end": 40245034}, {"filename": "/resources_js/fr/aspell/fr-80.multi", "start": 40245034, "end": 40245112}], "remote_package_size": 40245112});

  })();
