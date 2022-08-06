
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
    loadPackage({"files": [{"filename": "/resources_js/fr/presage.xml", "start": 0, "end": 2809}, {"filename": "/resources_js/fr/presage2.xml", "start": 2809, "end": 5514}, {"filename": "/resources_js/fr/hunspell/fr_FR.aff", "start": 5514, "end": 297783}, {"filename": "/resources_js/fr/hunspell/fr_FR.dic", "start": 297783, "end": 2889834}, {"filename": "/resources_js/fr/ngrams_db/ngrams.counts", "start": 2889834, "end": 11361670}, {"filename": "/resources_js/fr/ngrams_db/ngrams.trie", "start": 11361670, "end": 23643454}, {"filename": "/resources_js/fr/aspell/fr_FR-lrg.alias", "start": 23643454, "end": 23643532}, {"filename": "/resources_js/fr/aspell/fr-med.alias", "start": 23643532, "end": 23643610}, {"filename": "/resources_js/fr/aspell/fr.dat", "start": 23643610, "end": 23643736}, {"filename": "/resources_js/fr/aspell/fr_FR-med.alias", "start": 23643736, "end": 23643814}, {"filename": "/resources_js/fr/aspell/fr_CH-only.rws", "start": 23643814, "end": 23646630}, {"filename": "/resources_js/fr/aspell/suisse-lrg.alias", "start": 23646630, "end": 23646708}, {"filename": "/resources_js/fr/aspell/fr_FR-80.multi", "start": 23646708, "end": 23646824}, {"filename": "/resources_js/fr/aspell/fr-60.multi", "start": 23646824, "end": 23646902}, {"filename": "/resources_js/fr/aspell/french-sml.alias", "start": 23646902, "end": 23646980}, {"filename": "/resources_js/fr/aspell/fr_CH-80.multi", "start": 23646980, "end": 23647115}, {"filename": "/resources_js/fr/aspell/standard.kbd", "start": 23647115, "end": 23647215}, {"filename": "/resources_js/fr/aspell/francais-40.alias", "start": 23647215, "end": 23647293}, {"filename": "/resources_js/fr/aspell/french-40.alias", "start": 23647293, "end": 23647371}, {"filename": "/resources_js/fr/aspell/fr-40.multi", "start": 23647371, "end": 23647449}, {"filename": "/resources_js/fr/aspell/suisse-80.alias", "start": 23647449, "end": 23647527}, {"filename": "/resources_js/fr/aspell/fr_FR-60.multi", "start": 23647527, "end": 23647624}, {"filename": "/resources_js/fr/aspell/french-med.alias", "start": 23647624, "end": 23647702}, {"filename": "/resources_js/fr/aspell/nroff.amf", "start": 23647702, "end": 23647851}, {"filename": "/resources_js/fr/aspell/suisse-med.alias", "start": 23647851, "end": 23647929}, {"filename": "/resources_js/fr/aspell/francais-med.alias", "start": 23647929, "end": 23648007}, {"filename": "/resources_js/fr/aspell/fr_CH-60.multi", "start": 23648007, "end": 23648123}, {"filename": "/resources_js/fr/aspell/fr_CH.multi", "start": 23648123, "end": 23648201}, {"filename": "/resources_js/fr/aspell/suisse-60.alias", "start": 23648201, "end": 23648279}, {"filename": "/resources_js/fr/aspell/french-60.alias", "start": 23648279, "end": 23648357}, {"filename": "/resources_js/fr/aspell/francais.alias", "start": 23648357, "end": 23648432}, {"filename": "/resources_js/fr/aspell/suisse.alias", "start": 23648432, "end": 23648507}, {"filename": "/resources_js/fr/aspell/fr-sml.alias", "start": 23648507, "end": 23648585}, {"filename": "/resources_js/fr/aspell/suisse-40.alias", "start": 23648585, "end": 23648663}, {"filename": "/resources_js/fr/aspell/fr_FR-sml.alias", "start": 23648663, "end": 23648741}, {"filename": "/resources_js/fr/aspell/fr_CH-40.multi", "start": 23648741, "end": 23648838}, {"filename": "/resources_js/fr/aspell/francais-60.alias", "start": 23648838, "end": 23648916}, {"filename": "/resources_js/fr/aspell/francais-80.alias", "start": 23648916, "end": 23648994}, {"filename": "/resources_js/fr/aspell/suisse-sml.alias", "start": 23648994, "end": 23649072}, {"filename": "/resources_js/fr/aspell/fr-80-only.rws", "start": 23649072, "end": 23983952}, {"filename": "/resources_js/fr/aspell/fr-lrg.alias", "start": 23983952, "end": 23984030}, {"filename": "/resources_js/fr/aspell/fr_phonet.dat", "start": 23984030, "end": 23986961}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cset", "start": 23986961, "end": 24000809}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cmap", "start": 24000809, "end": 24031703}, {"filename": "/resources_js/fr/aspell/fr.multi", "start": 24031703, "end": 24031778}, {"filename": "/resources_js/fr/aspell/french.alias", "start": 24031778, "end": 24031853}, {"filename": "/resources_js/fr/aspell/fr_FR.multi", "start": 24031853, "end": 24031931}, {"filename": "/resources_js/fr/aspell/francais-sml.alias", "start": 24031931, "end": 24032009}, {"filename": "/resources_js/fr/aspell/fr_CH-sml.alias", "start": 24032009, "end": 24032087}, {"filename": "/resources_js/fr/aspell/francais-lrg.alias", "start": 24032087, "end": 24032165}, {"filename": "/resources_js/fr/aspell/french-lrg.alias", "start": 24032165, "end": 24032243}, {"filename": "/resources_js/fr/aspell/fr-40-only.rws", "start": 24032243, "end": 29858979}, {"filename": "/resources_js/fr/aspell/french-80.alias", "start": 29858979, "end": 29859057}, {"filename": "/resources_js/fr/aspell/fr_CH-lrg.alias", "start": 29859057, "end": 29859135}, {"filename": "/resources_js/fr/aspell/fr_CH-med.alias", "start": 29859135, "end": 29859213}, {"filename": "/resources_js/fr/aspell/fr-60-only.rws", "start": 29859213, "end": 41449949}, {"filename": "/resources_js/fr/aspell/fr_FR-40.multi", "start": 41449949, "end": 41450027}, {"filename": "/resources_js/fr/aspell/fr-80.multi", "start": 41450027, "end": 41450105}], "remote_package_size": 41450105});

  })();
