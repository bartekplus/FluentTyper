// SAMPLE
this.manifest = {
    "name": "FluentBoard Settings",
    "icon": "icon/icon128.png",
    "settings": [{
            "tab": i18n.get("settings"),
            "group": i18n.get("General"),
            "name": "enable",
            "type": "checkbox",
            "label": i18n.get("enable")
        }, {
            "tab": i18n.get("settings"),
            "group": i18n.get("General"),
            "name": "enable",
            "type": "radioButtons",
            "options": [["Enabled by default (domain list is a blacklist)"] , [ "Disabled by default (domain list is a whitelist)"]],
            "label": "Operating mode:"
        },
        {
            "tab": "White List",
            "group": i18n.get("Management"),
            "name": "whiteListBox",
            "type": "listBox",
            //"label": "Soup 2 should be:",
            "options": function () {
                return;
            }()
        }, {
            "tab": "White List",
            "group": i18n.get("Management"),
            "name": "removeDomainBtn",
            "type": "button",
            "text": i18n.get("remove")
        }, {
            "tab": "Domain list",
            "group": i18n.get("add"),
            "name": "domain",
            "type": "text",
            "label": i18n.get("domain"),
            "text": i18n.get("x-domain"),
            "store": false
        }, {
            "tab": "Domain List",
            "group": i18n.get("add"),
            "name": "addDomainBtn",
            "type": "button",
            "text": i18n.get("add")
        }, {
            "tab":  "Domain List",
            "group": i18n.get("add"),
            "name": "addDomainDsc",
            "type": "description",
            "text": i18n.get("description-url")
        }, {
            "tab": i18n.get("About"),
            "group": i18n.get("FluentBoard"),
            "name": "FluentBoard",
            "type": "description",
            "text": i18n.get("x-FluentBoard")
        }, {
            "tab": i18n.get("About"),
            "group": i18n.get("Credits"),
            "name": "Credits",
            "type": "description",
            "text": i18n.get("x-Credits")
        },

    ],

};
