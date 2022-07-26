
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
      var PACKAGE_UUID = metadata['package_uuid'];

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
    loadPackage({"files": [{"filename": "/resources_js/fr/presage.xml", "start": 0, "end": 2802}, {"filename": "/resources_js/fr/hunspell/fr_FR.aff", "start": 2802, "end": 295071}, {"filename": "/resources_js/fr/hunspell/fr_FR.dic", "start": 295071, "end": 2887122}, {"filename": "/resources_js/fr/ngrams_db/ngrams.counts", "start": 2887122, "end": 11358958}, {"filename": "/resources_js/fr/ngrams_db/ngrams.trie", "start": 11358958, "end": 23640742}, {"filename": "/resources_js/fr/aspell/fr_FR-lrg.alias", "start": 23640742, "end": 23640820}, {"filename": "/resources_js/fr/aspell/fr-med.alias", "start": 23640820, "end": 23640898}, {"filename": "/resources_js/fr/aspell/fr.dat", "start": 23640898, "end": 23641024}, {"filename": "/resources_js/fr/aspell/fr_FR-med.alias", "start": 23641024, "end": 23641102}, {"filename": "/resources_js/fr/aspell/fr_CH-only.rws", "start": 23641102, "end": 23643918}, {"filename": "/resources_js/fr/aspell/suisse-lrg.alias", "start": 23643918, "end": 23643996}, {"filename": "/resources_js/fr/aspell/fr_FR-80.multi", "start": 23643996, "end": 23644112}, {"filename": "/resources_js/fr/aspell/fr-60.multi", "start": 23644112, "end": 23644190}, {"filename": "/resources_js/fr/aspell/french-sml.alias", "start": 23644190, "end": 23644268}, {"filename": "/resources_js/fr/aspell/fr_CH-80.multi", "start": 23644268, "end": 23644403}, {"filename": "/resources_js/fr/aspell/standard.kbd", "start": 23644403, "end": 23644503}, {"filename": "/resources_js/fr/aspell/francais-40.alias", "start": 23644503, "end": 23644581}, {"filename": "/resources_js/fr/aspell/french-40.alias", "start": 23644581, "end": 23644659}, {"filename": "/resources_js/fr/aspell/fr-40.multi", "start": 23644659, "end": 23644737}, {"filename": "/resources_js/fr/aspell/suisse-80.alias", "start": 23644737, "end": 23644815}, {"filename": "/resources_js/fr/aspell/fr_FR-60.multi", "start": 23644815, "end": 23644912}, {"filename": "/resources_js/fr/aspell/french-med.alias", "start": 23644912, "end": 23644990}, {"filename": "/resources_js/fr/aspell/suisse-med.alias", "start": 23644990, "end": 23645068}, {"filename": "/resources_js/fr/aspell/francais-med.alias", "start": 23645068, "end": 23645146}, {"filename": "/resources_js/fr/aspell/fr_CH-60.multi", "start": 23645146, "end": 23645262}, {"filename": "/resources_js/fr/aspell/fr_CH.multi", "start": 23645262, "end": 23645340}, {"filename": "/resources_js/fr/aspell/suisse-60.alias", "start": 23645340, "end": 23645418}, {"filename": "/resources_js/fr/aspell/french-60.alias", "start": 23645418, "end": 23645496}, {"filename": "/resources_js/fr/aspell/francais.alias", "start": 23645496, "end": 23645571}, {"filename": "/resources_js/fr/aspell/suisse.alias", "start": 23645571, "end": 23645646}, {"filename": "/resources_js/fr/aspell/fr-sml.alias", "start": 23645646, "end": 23645724}, {"filename": "/resources_js/fr/aspell/suisse-40.alias", "start": 23645724, "end": 23645802}, {"filename": "/resources_js/fr/aspell/fr_FR-sml.alias", "start": 23645802, "end": 23645880}, {"filename": "/resources_js/fr/aspell/fr_CH-40.multi", "start": 23645880, "end": 23645977}, {"filename": "/resources_js/fr/aspell/francais-60.alias", "start": 23645977, "end": 23646055}, {"filename": "/resources_js/fr/aspell/francais-80.alias", "start": 23646055, "end": 23646133}, {"filename": "/resources_js/fr/aspell/suisse-sml.alias", "start": 23646133, "end": 23646211}, {"filename": "/resources_js/fr/aspell/fr-80-only.rws", "start": 23646211, "end": 23981091}, {"filename": "/resources_js/fr/aspell/fr-lrg.alias", "start": 23981091, "end": 23981169}, {"filename": "/resources_js/fr/aspell/fr_phonet.dat", "start": 23981169, "end": 23984100}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cset", "start": 23984100, "end": 23997948}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cmap", "start": 23997948, "end": 24028842}, {"filename": "/resources_js/fr/aspell/fr.multi", "start": 24028842, "end": 24028917}, {"filename": "/resources_js/fr/aspell/french.alias", "start": 24028917, "end": 24028992}, {"filename": "/resources_js/fr/aspell/fr_FR.multi", "start": 24028992, "end": 24029070}, {"filename": "/resources_js/fr/aspell/francais-sml.alias", "start": 24029070, "end": 24029148}, {"filename": "/resources_js/fr/aspell/fr_CH-sml.alias", "start": 24029148, "end": 24029226}, {"filename": "/resources_js/fr/aspell/francais-lrg.alias", "start": 24029226, "end": 24029304}, {"filename": "/resources_js/fr/aspell/french-lrg.alias", "start": 24029304, "end": 24029382}, {"filename": "/resources_js/fr/aspell/fr-40-only.rws", "start": 24029382, "end": 29856118}, {"filename": "/resources_js/fr/aspell/french-80.alias", "start": 29856118, "end": 29856196}, {"filename": "/resources_js/fr/aspell/fr_CH-lrg.alias", "start": 29856196, "end": 29856274}, {"filename": "/resources_js/fr/aspell/fr_CH-med.alias", "start": 29856274, "end": 29856352}, {"filename": "/resources_js/fr/aspell/fr-60-only.rws", "start": 29856352, "end": 41447088}, {"filename": "/resources_js/fr/aspell/fr_FR-40.multi", "start": 41447088, "end": 41447166}, {"filename": "/resources_js/fr/aspell/fr-80.multi", "start": 41447166, "end": 41447244}], "remote_package_size": 41447244, "package_uuid": "89dd7054-53c3-43a7-b553-21d501a5fe65"});

  })();
