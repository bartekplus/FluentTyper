window.addEvent("domready", function () {
    // Option 1: Use the manifest:
    new FancySettings.initWithManifest(function (settings) {
        settings.manifest.addDomainBtn.addEvent("action", function () {
        	var domainURL = settings.manifest.domain.get();
        	var elem = new Element("option", {"value": domainURL, "text": domainURL });
        	settings.manifest.domainList.add(domainURL);
        });
        
        settings.manifest.removeDomainBtn.addEvent("action", function () {
        	settings.manifest.domainList.remove();
        });
    });
});
