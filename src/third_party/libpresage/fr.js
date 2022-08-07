
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
    loadPackage({"files": [{"filename": "/resources_js/fr/presage.xml", "start": 0, "end": 2809}, {"filename": "/resources_js/fr/hunspell/fr_FR.aff", "start": 2809, "end": 295078}, {"filename": "/resources_js/fr/hunspell/fr_FR.dic", "start": 295078, "end": 2887129}, {"filename": "/resources_js/fr/ngrams_db/ngrams.counts", "start": 2887129, "end": 10868077}, {"filename": "/resources_js/fr/ngrams_db/ngrams.trie", "start": 10868077, "end": 21490845}, {"filename": "/resources_js/fr/aspell/fr_FR-lrg.alias", "start": 21490845, "end": 21490923}, {"filename": "/resources_js/fr/aspell/fr-med.alias", "start": 21490923, "end": 21491001}, {"filename": "/resources_js/fr/aspell/fr.dat", "start": 21491001, "end": 21491127}, {"filename": "/resources_js/fr/aspell/fr_FR-med.alias", "start": 21491127, "end": 21491205}, {"filename": "/resources_js/fr/aspell/fr_CH-only.rws", "start": 21491205, "end": 21494021}, {"filename": "/resources_js/fr/aspell/suisse-lrg.alias", "start": 21494021, "end": 21494099}, {"filename": "/resources_js/fr/aspell/fr_FR-80.multi", "start": 21494099, "end": 21494215}, {"filename": "/resources_js/fr/aspell/fr-60.multi", "start": 21494215, "end": 21494293}, {"filename": "/resources_js/fr/aspell/french-sml.alias", "start": 21494293, "end": 21494371}, {"filename": "/resources_js/fr/aspell/fr_CH-80.multi", "start": 21494371, "end": 21494506}, {"filename": "/resources_js/fr/aspell/standard.kbd", "start": 21494506, "end": 21494606}, {"filename": "/resources_js/fr/aspell/francais-40.alias", "start": 21494606, "end": 21494684}, {"filename": "/resources_js/fr/aspell/french-40.alias", "start": 21494684, "end": 21494762}, {"filename": "/resources_js/fr/aspell/fr-40.multi", "start": 21494762, "end": 21494840}, {"filename": "/resources_js/fr/aspell/suisse-80.alias", "start": 21494840, "end": 21494918}, {"filename": "/resources_js/fr/aspell/fr_FR-60.multi", "start": 21494918, "end": 21495015}, {"filename": "/resources_js/fr/aspell/french-med.alias", "start": 21495015, "end": 21495093}, {"filename": "/resources_js/fr/aspell/nroff.amf", "start": 21495093, "end": 21495242}, {"filename": "/resources_js/fr/aspell/suisse-med.alias", "start": 21495242, "end": 21495320}, {"filename": "/resources_js/fr/aspell/francais-med.alias", "start": 21495320, "end": 21495398}, {"filename": "/resources_js/fr/aspell/fr_CH-60.multi", "start": 21495398, "end": 21495514}, {"filename": "/resources_js/fr/aspell/fr_CH.multi", "start": 21495514, "end": 21495592}, {"filename": "/resources_js/fr/aspell/suisse-60.alias", "start": 21495592, "end": 21495670}, {"filename": "/resources_js/fr/aspell/french-60.alias", "start": 21495670, "end": 21495748}, {"filename": "/resources_js/fr/aspell/francais.alias", "start": 21495748, "end": 21495823}, {"filename": "/resources_js/fr/aspell/suisse.alias", "start": 21495823, "end": 21495898}, {"filename": "/resources_js/fr/aspell/fr-sml.alias", "start": 21495898, "end": 21495976}, {"filename": "/resources_js/fr/aspell/suisse-40.alias", "start": 21495976, "end": 21496054}, {"filename": "/resources_js/fr/aspell/fr_FR-sml.alias", "start": 21496054, "end": 21496132}, {"filename": "/resources_js/fr/aspell/fr_CH-40.multi", "start": 21496132, "end": 21496229}, {"filename": "/resources_js/fr/aspell/francais-60.alias", "start": 21496229, "end": 21496307}, {"filename": "/resources_js/fr/aspell/francais-80.alias", "start": 21496307, "end": 21496385}, {"filename": "/resources_js/fr/aspell/suisse-sml.alias", "start": 21496385, "end": 21496463}, {"filename": "/resources_js/fr/aspell/fr-80-only.rws", "start": 21496463, "end": 21831343}, {"filename": "/resources_js/fr/aspell/fr-lrg.alias", "start": 21831343, "end": 21831421}, {"filename": "/resources_js/fr/aspell/fr_phonet.dat", "start": 21831421, "end": 21834352}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cset", "start": 21834352, "end": 21848200}, {"filename": "/resources_js/fr/aspell/iso-8859-1.cmap", "start": 21848200, "end": 21879094}, {"filename": "/resources_js/fr/aspell/fr.multi", "start": 21879094, "end": 21879169}, {"filename": "/resources_js/fr/aspell/french.alias", "start": 21879169, "end": 21879244}, {"filename": "/resources_js/fr/aspell/fr_FR.multi", "start": 21879244, "end": 21879322}, {"filename": "/resources_js/fr/aspell/francais-sml.alias", "start": 21879322, "end": 21879400}, {"filename": "/resources_js/fr/aspell/fr_CH-sml.alias", "start": 21879400, "end": 21879478}, {"filename": "/resources_js/fr/aspell/francais-lrg.alias", "start": 21879478, "end": 21879556}, {"filename": "/resources_js/fr/aspell/french-lrg.alias", "start": 21879556, "end": 21879634}, {"filename": "/resources_js/fr/aspell/fr-40-only.rws", "start": 21879634, "end": 27706370}, {"filename": "/resources_js/fr/aspell/french-80.alias", "start": 27706370, "end": 27706448}, {"filename": "/resources_js/fr/aspell/fr_CH-lrg.alias", "start": 27706448, "end": 27706526}, {"filename": "/resources_js/fr/aspell/fr_CH-med.alias", "start": 27706526, "end": 27706604}, {"filename": "/resources_js/fr/aspell/fr-60-only.rws", "start": 27706604, "end": 39297340}, {"filename": "/resources_js/fr/aspell/fr_FR-40.multi", "start": 39297340, "end": 39297418}, {"filename": "/resources_js/fr/aspell/fr-80.multi", "start": 39297418, "end": 39297496}], "remote_package_size": 39297496});

  })();
