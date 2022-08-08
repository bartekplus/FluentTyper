
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
    loadPackage({"files": [{"filename": "/resources_js/fr/presage.xml", "start": 0, "end": 2809}, {"filename": "/resources_js/fr/hunspell/fr_FR.aff", "start": 2809, "end": 295078}, {"filename": "/resources_js/fr/hunspell/fr_FR.dic", "start": 295078, "end": 2887129}, {"filename": "/resources_js/fr/ngrams_db/ngrams.counts", "start": 2887129, "end": 11293365}, {"filename": "/resources_js/fr/ngrams_db/ngrams.trie", "start": 11293365, "end": 23310653}, {"filename": "/resources_js/fr/aspell/fr_FR-lrg.alias", "start": 23310653, "end": 23310731}, {"filename": "/resources_js/fr/aspell/fr-med.alias", "start": 23310731, "end": 23310809}, {"filename": "/resources_js/fr/aspell/fr.dat", "start": 23310809, "end": 23310935}, {"filename": "/resources_js/fr/aspell/fr_FR-med.alias", "start": 23310935, "end": 23311013}, {"filename": "/resources_js/fr/aspell/fr_CH-only.rws", "start": 23311013, "end": 23313829}, {"filename": "/resources_js/fr/aspell/suisse-lrg.alias", "start": 23313829, "end": 23313907}, {"filename": "/resources_js/fr/aspell/fr_FR-80.multi", "start": 23313907, "end": 23314023}, {"filename": "/resources_js/fr/aspell/fr-60.multi", "start": 23314023, "end": 23314101}, {"filename": "/resources_js/fr/aspell/french-sml.alias", "start": 23314101, "end": 23314179}, {"filename": "/resources_js/fr/aspell/fr_CH-80.multi", "start": 23314179, "end": 23314314}, {"filename": "/resources_js/fr/aspell/standard.kbd", "start": 23314314, "end": 23314414}, {"filename": "/resources_js/fr/aspell/francais-40.alias", "start": 23314414, "end": 23314492}, {"filename": "/resources_js/fr/aspell/french-40.alias", "start": 23314492, "end": 23314570}, {"filename": "/resources_js/fr/aspell/fr-40.multi", "start": 23314570, "end": 23314648}, {"filename": "/resources_js/fr/aspell/suisse-80.alias", "start": 23314648, "end": 23314726}, {"filename": "/resources_js/fr/aspell/fr_FR-60.multi", "start": 23314726, "end": 23314823}, {"filename": "/resources_js/fr/aspell/french-med.alias", "start": 23314823, "end": 23314901}, {"filename": "/resources_js/fr/aspell/nroff.amf", "start": 23314901, "end": 23315050}, {"filename": "/resources_js/fr/aspell/suisse-med.alias", "start": 23315050, "end": 23315128}, {"filename": "/resources_js/fr/aspell/francais-med.alias", "start": 23315128, "end": 23315206}, {"filename": "/resources_js/fr/aspell/fr_CH-60.multi", "start": 23315206, "end": 23315322}, {"filename": "/resources_js/fr/aspell/fr_CH.multi", "start": 23315322, "end": 23315400}, {"filename": "/resources_js/fr/aspell/suisse-60.alias", "start": 23315400, "end": 23315478}, {"filename": "/resources_js/fr/aspell/french-60.alias", "start": 23315478, "end": 23315556}, {"filename": "/resources_js/fr/aspell/francais.alias", "start": 23315556, "end": 23315631}, {"filename": "/resources_js/fr/aspell/suisse.alias", "start": 23315631, "end": 23315706}, {"filename": "/resources_js/fr/aspell/fr-sml.alias", "start": 23315706, "end": 23315784}, {"filename": "/resources_js/fr/aspell/suisse-40.alias", "start": 23315784, "end": 23315862}, {"filename": "/resources_js/fr/aspell/fr_FR-sml.alias", "start": 23315862, "end": 23315940}, {"filename": "/resources_js/fr/aspell/fr_CH-40.multi", "start": 23315940, "end": 23316037}, {"filename": "/resources_js/fr/aspell/francais-60.alias", "start": 23316037, "end": 23316115}, {"filename": "/resources_js/fr/aspell/francais-80.alias", "start": 23316115, "end": 23316193}, {"filename": "/resources_js/fr/aspell/suisse-sml.alias", "start": 23316193, "end": 23316271}, {"filename": "/resources_js/fr/aspell/fr-80-only.rws", "start": 23316271, "end": 23651151}, {"filename": "/resources_js/fr/aspell/fr-lrg.alias", "start": 23651151, "end": 23651229}, {"filename": "/resources_js/fr/aspell/fr_phonet.dat", "start": 23651229, "end": 23654160}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cset", "start": 23654160, "end": 23668008}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cmap", "start": 23668008, "end": 23698902}, {"filename": "/resources_js/fr/aspell/fr.multi", "start": 23698902, "end": 23698977}, {"filename": "/resources_js/fr/aspell/french.alias", "start": 23698977, "end": 23699052}, {"filename": "/resources_js/fr/aspell/fr_FR.multi", "start": 23699052, "end": 23699130}, {"filename": "/resources_js/fr/aspell/francais-sml.alias", "start": 23699130, "end": 23699208}, {"filename": "/resources_js/fr/aspell/fr_CH-sml.alias", "start": 23699208, "end": 23699286}, {"filename": "/resources_js/fr/aspell/francais-lrg.alias", "start": 23699286, "end": 23699364}, {"filename": "/resources_js/fr/aspell/french-lrg.alias", "start": 23699364, "end": 23699442}, {"filename": "/resources_js/fr/aspell/fr-40-only.rws", "start": 23699442, "end": 29526178}, {"filename": "/resources_js/fr/aspell/french-80.alias", "start": 29526178, "end": 29526256}, {"filename": "/resources_js/fr/aspell/fr_CH-lrg.alias", "start": 29526256, "end": 29526334}, {"filename": "/resources_js/fr/aspell/fr_CH-med.alias", "start": 29526334, "end": 29526412}, {"filename": "/resources_js/fr/aspell/fr-60-only.rws", "start": 29526412, "end": 41117148}, {"filename": "/resources_js/fr/aspell/fr_FR-40.multi", "start": 41117148, "end": 41117226}, {"filename": "/resources_js/fr/aspell/fr-80.multi", "start": 41117226, "end": 41117304}], "remote_package_size": 41117304});

  })();
