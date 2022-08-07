
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
      var PACKAGE_NAME = 'en.data';
      var REMOTE_PACKAGE_BASE = 'en.data';
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
Module['FS_createPath']("/resources_js", "en", true, true);
Module['FS_createPath']("/resources_js/en", "hunspell", true, true);
Module['FS_createPath']("/resources_js/en", "ngrams_db", true, true);
Module['FS_createPath']("/resources_js/en", "aspell", true, true);

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
          }          Module['removeRunDependency']('datafile_en.data');

      };
      Module['addRunDependency']('datafile_en.data');

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
    loadPackage({"files": [{"filename": "/resources_js/en/presage.xml", "start": 0, "end": 2812}, {"filename": "/resources_js/en/hunspell/en_US.dic", "start": 2812, "end": 869370}, {"filename": "/resources_js/en/hunspell/en_US.aff", "start": 869370, "end": 872461}, {"filename": "/resources_js/en/ngrams_db/ngrams.counts", "start": 872461, "end": 14172393}, {"filename": "/resources_js/en/ngrams_db/ngrams.trie", "start": 14172393, "end": 27368785}, {"filename": "/resources_js/en/aspell/en-wo_accents-only.rws", "start": 27368785, "end": 27544865}, {"filename": "/resources_js/en/aspell/en_US.multi", "start": 27544865, "end": 27544951}, {"filename": "/resources_js/en/aspell/standard.kbd", "start": 27544951, "end": 27545051}, {"filename": "/resources_js/en/aspell/en-variant_0.rws", "start": 27545051, "end": 27584827}, {"filename": "/resources_js/en/aspell/en_US-wo_accents-only.rws", "start": 27584827, "end": 27686859}, {"filename": "/resources_js/en/aspell/en-variant_1.rws", "start": 27686859, "end": 27780299}, {"filename": "/resources_js/en/aspell/en_US-w_accents-only.rws", "start": 27780299, "end": 27882331}, {"filename": "/resources_js/en/aspell/en-w_accents-only.rws", "start": 27882331, "end": 28058411}, {"filename": "/resources_js/en/aspell/en-variant_2.rws", "start": 28058411, "end": 28160571}, {"filename": "/resources_js/en/aspell/en_US-variant_1.multi", "start": 28160571, "end": 28160653}, {"filename": "/resources_js/en/aspell/en_affix.dat", "start": 28160653, "end": 28165328}, {"filename": "/resources_js/en/aspell/en.multi", "start": 28165328, "end": 28165411}, {"filename": "/resources_js/en/aspell/en_US-wo_accents.multi", "start": 28165411, "end": 28165518}, {"filename": "/resources_js/en/aspell/en-w_accents.multi", "start": 28165518, "end": 28165621}, {"filename": "/resources_js/en/aspell/en-wo_accents.multi", "start": 28165621, "end": 28165725}, {"filename": "/resources_js/en/aspell/en-variant_2.multi", "start": 28165725, "end": 28165805}, {"filename": "/resources_js/en/aspell/en-variant_0.multi", "start": 28165805, "end": 28165885}, {"filename": "/resources_js/en/aspell/en_US-w_accents.multi", "start": 28165885, "end": 28165991}, {"filename": "/resources_js/en/aspell/iso-8859-1.cset", "start": 28165991, "end": 28179839}, {"filename": "/resources_js/en/aspell/iso-8859-1.cmap", "start": 28179839, "end": 28210733}, {"filename": "/resources_js/en/aspell/en_phonet.dat", "start": 28210733, "end": 28218006}, {"filename": "/resources_js/en/aspell/en-common.rws", "start": 28218006, "end": 30641462}, {"filename": "/resources_js/en/aspell/en_US-variant_0.multi", "start": 30641462, "end": 30641544}, {"filename": "/resources_js/en/aspell/en-variant_1.multi", "start": 30641544, "end": 30641624}, {"filename": "/resources_js/en/aspell/en.dat", "start": 30641624, "end": 30641712}], "remote_package_size": 30641712});

  })();
