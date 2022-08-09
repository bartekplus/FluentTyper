
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
    loadPackage({"files": [{"filename": "/resources_js/en/presage.xml", "start": 0, "end": 2812}, {"filename": "/resources_js/en/hunspell/en_US.dic", "start": 2812, "end": 869370}, {"filename": "/resources_js/en/hunspell/en_US.aff", "start": 869370, "end": 872461}, {"filename": "/resources_js/en/ngrams_db/ngrams.counts", "start": 872461, "end": 13504909}, {"filename": "/resources_js/en/ngrams_db/ngrams.trie", "start": 13504909, "end": 26013541}, {"filename": "/resources_js/en/aspell/en-wo_accents-only.rws", "start": 26013541, "end": 26189621}, {"filename": "/resources_js/en/aspell/en_US.multi", "start": 26189621, "end": 26189707}, {"filename": "/resources_js/en/aspell/standard.kbd", "start": 26189707, "end": 26189807}, {"filename": "/resources_js/en/aspell/en-variant_0.rws", "start": 26189807, "end": 26229583}, {"filename": "/resources_js/en/aspell/en_US-wo_accents-only.rws", "start": 26229583, "end": 26331615}, {"filename": "/resources_js/en/aspell/en-variant_1.rws", "start": 26331615, "end": 26425055}, {"filename": "/resources_js/en/aspell/en_US-w_accents-only.rws", "start": 26425055, "end": 26527087}, {"filename": "/resources_js/en/aspell/en-w_accents-only.rws", "start": 26527087, "end": 26703167}, {"filename": "/resources_js/en/aspell/en-variant_2.rws", "start": 26703167, "end": 26805327}, {"filename": "/resources_js/en/aspell/en_US-variant_1.multi", "start": 26805327, "end": 26805409}, {"filename": "/resources_js/en/aspell/en_affix.dat", "start": 26805409, "end": 26810084}, {"filename": "/resources_js/en/aspell/en.multi", "start": 26810084, "end": 26810167}, {"filename": "/resources_js/en/aspell/en_US-wo_accents.multi", "start": 26810167, "end": 26810274}, {"filename": "/resources_js/en/aspell/en-w_accents.multi", "start": 26810274, "end": 26810377}, {"filename": "/resources_js/en/aspell/en-wo_accents.multi", "start": 26810377, "end": 26810481}, {"filename": "/resources_js/en/aspell/en-variant_2.multi", "start": 26810481, "end": 26810561}, {"filename": "/resources_js/en/aspell/en-variant_0.multi", "start": 26810561, "end": 26810641}, {"filename": "/resources_js/en/aspell/en_US-w_accents.multi", "start": 26810641, "end": 26810747}, {"filename": "/resources_js/en/aspell/iso-8859-1.cset", "start": 26810747, "end": 26824595}, {"filename": "/resources_js/en/aspell/iso-8859-1.cmap", "start": 26824595, "end": 26855489}, {"filename": "/resources_js/en/aspell/en_phonet.dat", "start": 26855489, "end": 26862762}, {"filename": "/resources_js/en/aspell/en-common.rws", "start": 26862762, "end": 29286218}, {"filename": "/resources_js/en/aspell/en_US-variant_0.multi", "start": 29286218, "end": 29286300}, {"filename": "/resources_js/en/aspell/en-variant_1.multi", "start": 29286300, "end": 29286380}, {"filename": "/resources_js/en/aspell/en.dat", "start": 29286380, "end": 29286468}], "remote_package_size": 29286468});

  })();
